const io = require( 'socket.io-client' );
const { Module, ModuleTrigger, ModuleTriggerArg } = require( './module' );

// controls the JEFF_APPS live event server
// using socket.io protocol
class JMLiveEventController extends Module {
  static name = 'jm_app_live_event';
  static niceName = 'Jeff Mikels Apps Live Event Controller';
  static create( config ) {
    return new JMLiveEventController( config );
  }

  constructor ( config ) {
    super( config );

    this.connected = false;
    this.controlling = false;
    this.future_progress = null;

    this.updateConfig( config );

    // LIVE EVENTS:
    // event[event_id]         ← requests control of an event
    // live[progress_integer]  ← sends progress to the event as an integer
    // const live_event_pattern = /event\[(\d+)\]/i;
    // const live_progress_pattern = /live\[(\d+)\]/i;
    this.registerTrigger(
      new ModuleTrigger(
        'event',
        'starts control for event',
        [ new ModuleTriggerArg( 'eid', 'number', 'event id', false ) ],
        ( _, eid ) => this.control( eid )
      )
    );

    this.registerTrigger(
      new ModuleTrigger(
        'live',
        'sends progress update for this event',
        [ new ModuleTriggerArg( 'progress', 'number', 'progress', false ) ],
        ( _, progress ) => {
          this.update( progress );

          // handle delayed event reset
          if ( progress == 999 )
            setTimeout( () => {
              this.update( 0 );
              this.log( 'automatically resetting event' );
            }, 60 * 1000 );
        }
      )
    );
  }

  updateConfig( config ) {
    super.updateConfig( config );
    let { url, eid = 0 } = config;
    this.eid = eid;
    this.connect( url );
  }

  connect( url ) {
    if ( this.socket ) this.socket.close();

    this.log( 'JEFF_APPS LIVE: connecting to ' + url );
    this.socket = io( url );

    this.socket.on( 'connect', () => {
      this.log( 'JEFF_APPS LIVE: connected' );
      this.connected = true;
      if ( this.eid ) this.control( this.eid );
    } );

    this.socket.on( 'disconnect', () => {
      this.log( 'JEFF_APPS LIVE: disconnected' );
      this.connected = false;
      this.controlling = false;
      this.eid = null;
    } );

    this.socket.on( 'control ready', ( data ) => {
      // console.log(data);
      this.log( 'JEFF_APPS LIVE: control confirmed for #' + this.eid );
      this.controlling = this.eid;
      if ( this.future_progress != null ) {
        this.update( this.future_progress );
        this.future_progress = null;
      }
    } );

    this.socket.on( 'update progress', ( progress ) => {
      this.log( `PROGRESS CONFIRMED: ${progress}` );
    } );

    if ( this.eid ) this.control( eid );
  }

  log( s ) {
    this.emit( 'update', s );
    console.log( s );
  }

  update( progress ) {
    if ( this.controlling ) {
      this.log( 'sending live progress: ' + progress );
      this.socket.emit( 'control', progress );
    } else {
      this.future_progress = progress;
    }
  }

  control( eid ) {
    if ( this.controlling == eid ) return;

    this.eid = eid;
    if ( this.connected ) {
      this.log( 'sending control request: ' + eid );
      this.socket.emit( 'control request', eid );
    }
  }
}

module.exports.JMLiveEventController = JMLiveEventController;
