const { Module, ModuleTrigger, ModuleTriggerArg } = require( './module' );

//Set up telnet client for talking to MxManager
var telnet = require( 'telnet-client' );
var tnc = new telnet();
var reconnectTimer = 0;
var heartbeatTimer = 0;
let poll_in = 500;

class OnyxController extends Module {
  static name = 'onyx';
  static niceName = 'Onyx Controller';
  static create( config ) {
    return new OnyxController( config );
  }

  constructor ( config ) {
    super( config );

    // Set some variables for tracking connection status
    this.connectedMPC = false;
    this.connectedTelnet = false;
    this.setupTelnetListeners();
    this.updateConfig( config );

    // onyx go pattern
    // onyxgo[cuelist, cue]
    const onyx_go_pattern = /onyxgo\[(.+?)\s*(?:,\s*(\d+))?\s*\]/gi;
    this.registerTrigger(
      new ModuleTrigger(
        'onyxgo',
        'fire an onyx cuelist with an optional specific cue',
        [
          new ModuleTriggerArg(
            'cuelist',
            'number',
            'onyx cuelist number',
            false
          ),
          new ModuleTriggerArg(
            'cue',
            'number',
            'onyx cue, defaults to null',
            true
          ),
        ],
        ( _, cuelist, cue = 0 ) => this.goCuelist( cuelist, cue )
      )
    );

    const onyx_release_pattern = /onyxrelease\[(.+?)\s*(?:,\s*(\d+))?\s*\]/gi;
    this.registerTrigger(
      new ModuleTrigger(
        'onyxrelease',
        'release an onyx cuelist, optionally a specific cue',
        [
          new ModuleTriggerArg(
            'cuelist',
            'number',
            'onyx cuelist number',
            false
          ),
          new ModuleTriggerArg(
            'cue',
            'number',
            'onyx cue, defaults to null',
            true
          ),
        ],
        ( _, cuelist, cue = 0 ) => this.releaseCuelist( cuelist, cue )
      )
    );
  }

  updateConfig( config ) {
    super.updateConfig( config );
    let { host, port } = config;
    this.onyxIP = host;
    this.onyxPort = port;
    this.connectTelnet();
  }

  setupTelnetListeners() {
    tnc.on( 'ready', ( _ ) => {
      this.connectedTelnet = true;
      console.log( '> Onyx Telnet Connection Established' );
    } );

    tnc.on( 'close', () => {
      this.connectedTelnet = false;
      this.connectedMPC = false;
      console.log( '> Onyx Telnet Connection Closed' );
      //Start a timer to reconnect, if one hasn't already been started
      if ( !reconnectTimer ) {
        reconnectTimer = setInterval( () => {
          this.reconnectTelnet();
        }, 5000 );
      }
      clearInterval( heartbeatTimer );
    } );

    tnc.on( 'error', ( e ) => {
      this.connectedTelnet = false;
      this.connectedMPC = false;
      console.log( '> Onyx Telnet Connection Error' );
      console.log( e );
    } );
  }

  reconnectTelnet() {
    // Clear the reconnect timer if we are reconnecting
    if ( reconnectTimer ) {
      clearInterval( reconnectTimer );
      reconnectTimer = 0;
    }
    this.connectTelnet();
  }

  // Connect to MxManager Telnet
  connectTelnet() {
    console.log( '> Connecting to MxManager Telnet' );
    tnc.connect( this.get_telnet_connect_settings() );
  }

  goCuelist( cuelist, cue = null ) {
    if ( cue === null ) {
      this.run_telnet( 'GQL ' + cuelist );
    } else {
      this.run_telnet( 'GTQ ' + cuelist + ' ' + cue );
    }
  }

  releaseCuelist( cuelist ) {
    this.run_telnet( 'RQL ' + cuelist );
  }

  get_telnet_connect_settings() {
    return {
      host: this.onyxIP,
      port: this.onyxPort,
      shellPrompt: '',
      timeout: 1500,
      negotiationMandatory: false,
    };
  }

  get_value_between( number, min, max ) {
    if ( number < min ) return min;
    else if ( number > max ) return max;
    else return number;
  }

  run_telnet( command, callback ) {
    tnc.send( command );
    /*
    let telnet_connection = new telnet();
    telnet_connection.connect(get_telnet_connect_settings())
      .then(function(){
        telnet_connection.send(command, {waitfor:'.\r\n'})
          .then(function(d){
            telnet_connection.end();
            let lines = d.split('\r\n');
            //Remove first 2 welcome lines
            delete lines[0];
            delete lines[1];
            callback(lines,command);
          },
          function(err){
            console.log('Error connecting to telnet: ' . err);
          })
      });
    */
  }
}

module.exports.OnyxController = OnyxController;
