const midi = require( 'midi' );
const { Module, ModuleTrigger, ModuleTriggerArg } = require( './module' );

class Timecode {
  constructor ( start, fps ) {
    let [ h, m, s, f ] = start.split( ':' );
    this.h = +h || 0;
    this.m = +m || 0;
    this.s = +s || 0;
    this.f = +f || 1;
    this.fps = +fps;
    this.framenumber = 1;
    this.frametime = 1000 / this.fps; // in milliseconds
  }

  next() {
    this.framenumber += 1;
    this.f += 1;
    if ( this.f > this.fps ) {
      this.f = 1;
      this.s += 1;
      if ( this.s > 59 ) {
        this.s = 0;
        this.m += 1;
        if ( this.m > 59 ) {
          this.m = 0;
          this.h += 1;
        }
      }
    }
  }

  toString() {
    let h = this.h.toString().padStart( 2, '0' );
    let m = this.m.toString().padStart( 2, '0' );
    let s = this.s.toString().padStart( 2, '0' );
    let f = this.f.toString().padStart( 2, '0' );
    return `${h}:${m}:${s}:${f}`;
  }
}

class MidiController extends Module {
  static name = 'midi';
  static niceName = 'MIDI Controller';
  static create( config ) {
    return new MidiController( config );
  }
  constructor ( config ) {
    super( config );

    // this.input = new midi.Input();
    this.output = new midi.Output();
    this.ports = [];

    // get ports
    let portCount = this.output.getPortCount();
    for ( let id = 0; id < portCount; id++ ) {
      let name = this.output.getPortName( id );
      this.ports.push( { id, name } );
      console.log( `MIDI PORT FOUND: ${id}: ${name}` );
    }

    this.connected = false;
    this.port = null;

    // keep a record of all notes that are currently "on"
    this.playing = [];
    this.timecode = null;
    this.mtcTimer = null;
    this.nextFullFrameTime = null;
    this.nextFrameTime = null;
    this.mtcStarted = 0;

    // MIDI:
    // note[note,[velocity],[channel]]
    // channel defaults to 0
    // velocity defaults to 127
    const midi_note_pattern = /note\[(\d+)\s*(?:,\s*(\d+?))?\s*(?:,\s*(\d+))?\s*\]/gi;
    this.registerTrigger(
      new ModuleTrigger(
        'note',
        'play a midi note to the connected port',
        [
          new ModuleTriggerArg( 'note', 'number', 'number from 0-127', false ),
          new ModuleTriggerArg(
            'velocity',
            'number',
            'velocity from 0-127 defaults to 127',
            true
          ),
          new ModuleTriggerArg(
            'channel',
            'number',
            'channel defaults to 0',
            true
          ),
        ],
        ( _, note, velocity = 127, channel = 0 ) =>
          this.hit( note, velocity, channel )
      )
    );

    // pc[program number, [channel]]
    // program change, channel defaults to 0
    const midi_pc_pattern = /pc\[(\d+)\s*(?:,\s*(\d+?))?\s*\]/gi;
    this.registerTrigger(
      new ModuleTrigger(
        'pc',
        'send a midi program change to the connected port',
        [
          new ModuleTriggerArg( 'program', 'number', 'number', false ),
          new ModuleTriggerArg(
            'channel',
            'number',
            'channel defaults to 0',
            true
          ),
        ],
        ( _, program, channel = 0 ) => this.program( program, channel )
      )
    );

    // cc[controller (0-127), value, [channel]]
    // channel defaults to 0
    // both are required
    // note that controllers 120-127 are reserved for special channel mode messages
    // 120,0 = all sound off
    // 121,0 = reset controllers
    // 122,0 = local control off
    // 122,127 = local control on
    // 123,0 = all notes off
    // 124,0 = omni mode off
    // 125,0 = omni mode on
    // 126,c = mono mode where c is number of channels
    // 127,0 = poly mode
    const midi_cc_pattern = /cc\[(\d+)\s*(?:,\s*(\d+?))?\s*(?:,\s*(\d+))?\s*\]/gi;
    this.registerTrigger(
      new ModuleTrigger(
        'cc',
        'send a midi control change to the connected port',
        [
          new ModuleTriggerArg(
            'controller',
            'number',
            'number from 0-127 (silence all by setting cc 120 and cc 123 to 0)',
            false
          ),
          new ModuleTriggerArg(
            'value',
            'number',
            'value from 0-127 defaults to 127',
            true
          ),
          new ModuleTriggerArg(
            'channel',
            'number',
            'channel defaults to 0',
            true
          ),
        ],
        ( _, controller, value = 127, channel = 0 ) =>
          this.control( controller, value, channel )
      )
    );

    // mtc[initial timecode string, fps]
    // timecode string should be of the format HH:MM:SS:FF where FF is the number of the frame, zero indexed
    // fps is frames per second... defaults to 24
    // mtc[] will turn off the timecode generator
    const midi_mtc_pattern = /mtc\[(?:(.+?))?\s*(?:,\s*(\d+))?\s*\]/gi;
    this.registerTrigger(
      new ModuleTrigger(
        'mtc',
        'start/stop playing midi timecode to the connected port',
        [
          new ModuleTriggerArg(
            'initial',
            'string',
            'HH:MM:SS:FF where FF is frame number',
            true
          ),
          new ModuleTriggerArg( 'fps', 'number', 'defaults to 24', true ),
        ],
        ( _, initial, fps = 24 ) =>
          initial == null ? this.mtcStop() : this.mtcStart( initial, fps )
      )
    );

    this.updateConfig( config );
  }

  updateConfig( config ) {
    super.updateConfig( config );
    if ( this.port ) this.closePort();
    if ( +( config.port ) ) this.openPort( +( config.port ) );
  }

  status() {
    return {
      connected: this.connected,
      ports: this.ports,
      port: this.port,
    };
  }

  closePort() {
    this.output.closePort();
    this.connected = false;
    this.port = null;
  }

  openPort( id = 0 ) {
    if ( id >= this.output.getPortCount() ) {
      return false;
    }
    console.log( `MIDI: OPENING PORT ${id} : ${this.ports[ id ].name}` );
    this.output.openPort( id );
    this.port = this.ports[ id ];
    this.connected = true;
  }

  // message should be an array matching the specification
  // here: http://www.midi.org/techspecs/midimessages.php
  // it's a plain wrapper for the node-midi function
  send( message ) {
    // console.log(message);
    this.output.sendMessage( message );
  }

  panic() {
    for ( let channel = 0; channel < 16; channel++ ) {
      this.control( 120, 0, channel ); // all sound off
      this.control( 123, 0, channel ); // all notes off
    }
  }

  allOff() {
    for ( let [ note, data ] of Object.entries( this.notes ) ) {
      if ( data.playing ) this.note( note );
    }
  }

  // simulates a note on/off sequence
  hit( note, velocity = 127, channel = 0, duration = 100 ) {
    this.note( note, velocity, channel );
    setTimeout( () => {
      this.note( note, 0, 0 );
    }, duration );
  }

  // to send note off, just set velocity to 0
  note( note, velocity = 0, channel = 0 ) {
    console.log( `MIDI NOTE: ${channel}, ${note}, ${velocity}` );
    if ( velocity > 0 ) {
      this.send( [ 0b10010000 + channel, note, velocity ] );
      this.playing.push( { note, channel, velocity } );
    } else {
      this.send( [ 0b10000000 + channel, note, 0 ] );
      let playing = [];
      for ( let data of this.playing ) {
        if ( data.note == note && data.channel == channel ) continue;
        playing.push( data );
      }
      this.playing = playing;
    }
  }

  control( controller, value, channel = 0 ) {
    console.log( `MIDI CONTROL: ${channel}, ${controller}, ${value}` );
    this.send( [ 0b10110000 + channel, controller, value ] );
  }

  program( program, channel = 0 ) {
    console.log( `MIDI PROGRAM: ${channel}, ${program}` );
    this.send( [ 0b11000000 + channel, program ] );
  }

  mtcQuarterFrames( part = 0, timecode = null ) {
    if ( part == 8 ) return;
    if ( timecode === null ) timecode = this.timecode;
    let qframe = mtc_quarter_frame( timecode, part );
    this.send( qframe );
    this.mtcQuarterFrames( part + 1, timecode );
  }

  mtcFullFrame() {
    this.send( mtc_full_frame( this.timecode ) );
  }

  mtcLoop() {
    let now = Date.now();
    if ( now > this.nextFrameTime ) {
      this.timecode.next();
      this.nextFrameTime =
        this.mtcStarted + this.timecode.framenumber * this.timecode.frametime;
      if ( now > this.nextFullFrameTime ) {
        // console.log(`MTC: ${this.timecode.toString()}`);
        this.mtcFullFrame();
        this.nextFullFrameTime =
          this.nextFrameTime + 60 * this.timecode.frametime;
      } else {
        this.mtcQuarterFrames();
      }
    }
    let sleep = this.nextFrameTime - now;
    if ( sleep < 0 ) sleep = 0;
    this.mtcTimer = setTimeout( () => {
      this.mtcLoop();
    }, sleep );
  }

  mtcStart( timecode = '01:00:00:01', fps = 24 ) {
    console.log( 'MIDI MTC: Starting...' );
    this.timecode = new Timecode( timecode, fps );
    console.log( this.timecode );
    this.mtcStarted = Date.now();
    this.nextFullFrameTime = this.mtcStarted;
    this.nextFrameTime =
      this.nextFullFrameTime +
      this.timecode.framenumber * this.timecode.frametime;
    this.mtcLoop();
  }

  mtcStop() {
    if ( this.mtcTimer ) clearTimeout( this.mtcTimer );
  }
}

function mtc_quarter_frame( timecode, piece = 0 ) {
  // there are 8 different mtc_quarter frame pieces
  // see https://en.wikipedia.org/wiki/MIDI_timecode
  // and https://web.archive.org/web/20120212181214/http://home.roadrunner.com/~jgglatt/tech/mtc.htm
  // these are little - endian bytes
  // piece 0 : 0xF1 0000 ffff frame
  let bytes = mtc_bytes( timecode );
  let byte_index = 3 - Math.floor( piece / 2 );
  let byte = bytes[ byte_index ];

  // even pieces get the low nibble
  // odd pieces get the high nibble
  let nibble;
  if ( piece % 2 == 0 ) {
    nibble = byte & 15;
  } else {
    nibble = byte >> 4;
  }
  return [ 0xf1, piece * 16 + nibble ];
}

function mtc_full_frame( timecode ) {
  let bytes = mtc_bytes( timecode );
  return [ 0xf0, 0x7f, 0x7f, 0x01, 0x01, ...bytes, 0xf7 ];
}

function mtc_bytes( timecode ) {
  // MIDI bytes are little-endian
  // Byte 0
  //   0rrhhhhh: Rate (0–3) and hour (0–23).
  //   rr = 000: 24 frames/s
  //   rr = 001: 25 frames/s
  //   rr = 010: 29.97 frames/s (SMPTE drop-frame timecode)
  //   rr = 011: 30 frames/s
  // Byte 1
  //   00mmmmmm: Minute (0–59)
  // Byte 2
  //   00ssssss: Second (0–59)
  // Byte 3
  //   000fffff: Frame (0–29, or less at lower frame rates)
  let { h, m, s, f, fps } = timecode;
  let rateflag;
  switch ( fps ) {
    case 24:
      rateflag = 0;
      break;
    case 25:
      rateflag = 1;
      break;
    case 29.97:
      rateflag = 2;
      break;
    case 30:
      rateflag = 3;
      break;
  }
  rateflag *= 32; // multiply by 32, because the rate flag starts at bit 6
  return [ rateflag + h, m, s, f ];
}

module.exports.MidiController = MidiController;
