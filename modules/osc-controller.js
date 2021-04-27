const osc = require( 'osc' );
const { Module, ModuleTrigger, ModuleTriggerArg } = require( './module' );

class OscController extends Module {
	static name = 'osc';
	static niceName = 'OSC Controller';

	static create( config ) {
		return new OscController( config );
	}
	constructor ( config ) {
		super( config );

		// OSC:
		// osc[address, typestring, ...args]
		this.registerTrigger(
			new ModuleTrigger(
				'osc',
				'parse and send an osc message',
				[
					new ModuleTriggerArg( 'address', 'string', 'osc address string', false ),
					new ModuleTriggerArg(
						'typestring',
						'string',
						'node osc typestring ifstbrm  is int, float, string, time, blob, rgba, midi',
						true
					),
					new ModuleTriggerArg(
						'...arguments',
						'dynamic',
						'remaining arguments will be parsed according to the typestring where rgba is written as #aabbccdd and blob and midi args are written in space-delimited hex arrays like [0x01 0x02]',
						true
					),
				],
				( _, address, typestring, ...args ) => {
					let msg = {
						address,
						args: []
					};
					for ( let i = 0; i < typestring.length; i++ ) {
						if ( i < args.length ) {
							let type = typestring[ i ];
							let value = args[ i ];
							switch ( type ) {
								case 's':
									// value already is a string
									break;
								case 'i':
									value = parseInt( value )
									break;
								case 'f':
									value = parseFloat( value );
									break;
								case 't':
									value = { native: parseInt( value ) } // timestamp
									break;
								case 'r':
									value = value.replace( /^#/, '0x' );
									value = parseInt( value );
									if ( isNaN( value ) ) {
										this.log( 'could not parse value into color' );
										continue;
									}
									value = {
										r: ( value & 0xFF000000 ) >> ( 32 ),
										g: ( value & 0x00FF0000 ) >> ( 16 ),
										b: ( value & 0x0000FF00 ) >> ( 8 ),
										a: ( value & 0x000000FF ),
									}

									break;
								case 'b':
								case 'm':
									let a = [];
									let error = false;
									value = value.replace( /[\[\]]/g, '' )
									for ( let v of value.split( ' ' ) ) {
										v = parseInt( v );
										if ( isNaN( v ) ) {
											error = true;
										} else {
											a.push( v )
										}
									}
									if ( error ) {
										this.log( 'could not parse array into list of bytes' );
										continue;
									} else {
										value = new Uint8Array( a );
									}
									break;
								default:
									continue;
							}
							msg.args.push( { type, value } );
						}
					}
					this.send( msg );
				}
			)
		);
		this.updateConfig( config );
	}

	updateConfig( config ) {
		super.updateConfig( config );
		this.host = config.host;
		this.port = config.port;
		this.proto = config.proto; // udp | tcp | ws
		this.connect();
	}

	close() {
		this.connected = false;
		if ( this.oscPort ) {
			this.oscPort.close();
			this.oscPort.removeAllListeners();
			this.oscPort = null;
		}
	}

	connect() {
		this.close();

		switch ( this.proto ) {
			case 'udp':
				this.oscPort = new osc.UDPPort( {
					localAddress: "0.0.0.0",
					remoteAddress: this.host,
					remotePort: this.port,
					metadata: true,
				} );
				break;
			case 'ws':
				this.oscPort = new osc.WebSocketPort( {
					url: `ws://${this.host}:${this.port}`,
					metadata: true,
				} );
				break;
			case 'tcp':
			default:
				this.oscPort = new osc.TCPSocketPort( {
					localAddress: "0.0.0.0",
					remoteAddress: this.host,
					remotePort: this.port,
					metadata: true,
				} );
		}
		if ( this.oscPort == null ) return;
		this.oscPort.on( 'ready', () => this.connected = true );
		this.oscPort.on( 'error', this.handleError );
		this.oscPort.on( 'message', this.handleMessage );
		// this.oscPort.on( 'bundle', this.handleBundle );

		this.oscPort.open();
	}

	handleError( e ) {
		this.log( e );
		this.emit( 'error', e );
		// this.connected = false;
	}

	// osc messages have two fields: address and args
	// address is a string like /an/osc/address
	// args are an array of objects with "type" and "value"
	// type can be i, f, s, t, b, r, m
	// for int32, float32, string, timetag, blob, rgba, midi
	// the timetag value is object with javascript timestamp in the "native" field
	// rgba value is an object with keys: r,g,b,a
	// blob value is Uint8Array
	// midi value is Uint8Array([port id, status, data1, data2])
	handleMessage( oscMsg, timeTag, info ) {
		this.log( `OSC MSG RECEIVED: ${JSON.stringify( oscMsg )}` );
		let address = oscMsg.address;
		let args = oscMsg.args;
	}

	status() {
		return {
			connected: this.connected,
		};
	}

	// message should be an osc message according to node osc package
	// https://www.npmjs.com/package/osc
	send( message ) {
		this.oscPort.send( message );
	}
}

module.exports.OscController = OscController;
