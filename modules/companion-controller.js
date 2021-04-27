const net = require( 'net' );
const { Module, ModuleTrigger, ModuleTriggerArg } = require( './module' );

class CompanionController extends Module {
  static supportsMultiple = true;
  static lastId = 0;
  static name = 'companion';
  static niceName = 'Companion Controller';
  static instances = [];

  static create( config ) {
    return new CompanionController( config );
  }

  constructor ( config, reset = false ) {
    super( config );


    if ( reset ) {
      for ( let i of CompanionController.instances ) {
        i.dispose();
      }
      CompanionController.instances.length = 0;
    }

    // store in the static instances list
    this.id = CompanionController.instances.length;
    CompanionController.instances.push( this );

    this.updateConfig( config );

    this.lastcommand = '';
    this.lastmessage = '';

    // COMPANION:
    // companionbutton[page number, button/bank number]
    const companion_button_pattern = /companionbutton\[\s*(.+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]/gi;
    this.registerTrigger(
      new ModuleTrigger(
        'companionbutton',
        'click a streamdeck button',
        [
          new ModuleTriggerArg( 'page', 'number', 'companion page 1-99', false ),
          new ModuleTriggerArg(
            'button',
            'number',
            'button / bank number',
            false
          ),
        ],
        ( _, page, button ) => this.buttonPress( page, button )
      )
    );

    // companionpage[page number, surface id]
    const companion_page_pattern = /companionpage\[\s*(.+)\s*,\s*(\d+)\s*,\s*(.+)\s*\]/gi;
    this.registerTrigger(
      new ModuleTrigger(
        'companionpage',
        'select a streamdeck page',
        [
          new ModuleTriggerArg( 'page', 'number', 'companion page 1-99', false ),
          new ModuleTriggerArg( 'surface', 'string', 'surface id', false ),
        ],
        ( _, page, surface ) => this.pageSelect( page, surface )
      )
    );

    this.onupdate = ( data ) => this.emit( 'update', data );
  }

  updateConfig( config ) {
    super.updateConfig( config );
    let { name, host, port } = config;
    this.name = name;
    this.host = host;
    this.port = +port;
  }

  msg( message ) {
    this.lastmessage = message;
    this.onupdate( message );
  }

  send( cmd ) {
    this.lastcommand = cmd;
    console.log( `COMPANION: ${this.host}:${this.port} ${cmd}` );
    this.msg( 'connecting to companion' );

    let client = new net.Socket();
    client.command = cmd; // save command to the client for later
    client.on( 'data', ( data ) => {
      let res = data.toString();
      console.log( `COMPANION RESPONSE: (${client.command}) -> ${res}` );
      if ( res.match( /\+OK/ ) ) this.msg( 'command successful' );
      else this.msg( 'command failed' );
    } );
    client.connect( this.port, this.host, () => {
      console.log( `COMPANION SENDING: ${cmd}` );
      this.msg( 'sending companion command' );
      client.write( cmd + '\x0a' );
      client.end();
    } );
  }

  pageSelect( page = null, surface = null ) {
    if ( page == null || surface == null ) {
      console.log( 'page select requires a page number and a surface id' );
      this.msg( 'error sending command' );
      return;
    } else {
      let cmd = `PAGE-SET ${page} ${surface}`;
      this.send( cmd );
    }
  }

  buttonPress( page = null, button = null ) {
    if ( page == null || button == null ) {
      console.log( 'button press requires a page and a button/bank number' );
      this.msg( 'error sending command' );
      return;
    } else {
      let cmd = `BANK-PRESS ${page} ${button}`;
      this.send( cmd );
    }
  }
}

module.exports.CompanionController = CompanionController;
