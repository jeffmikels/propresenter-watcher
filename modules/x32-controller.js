const osc = require( 'osc' );
const { Module, ModuleTrigger, ModuleTriggerArg } = require( './module' );


class X32Controller extends Module {
	static name = 'x32';
	static niceName = 'X32 Controller';

	static create( config ) {
		return new X32Controller( config );
	}

	// x32 always uses udp port 10023
	port = 10023;

	constructor ( config ) {
		super( config );

		// X32:
		// x32[address, typestring, ...args]
		this.registerTrigger(
			new ModuleTrigger(
				'x32',
				'parse and send an arbitrary x32 message',
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
										console.log( 'could not parse value into color' );
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
										console.log( 'could not parse array into list of bytes' );
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

		// x32mute[type indicator, id, onoff]
		// mute group with /config/mute/[1...6]
		// mute channel with /ch/01..32/mix/on
		// mute bus with /bus/01...16/mix/on
		// mute dca with /dca/1...8/on
		this.registerTrigger(
			new ModuleTrigger(
				'x32mute',
				'mutes a channel, group, dca, or bus',
				[
					new ModuleTriggerArg( 'cgdb', 'string', 'c, g, d, or b for channel, mute group, dca, or bus', false ),
					new ModuleTriggerArg(
						'id',
						'number',
						'channel or group id (starting from 1; 32 channels, 6 groups, 8 dca, 16 busses)',
						false
					),
					new ModuleTriggerArg(
						'onoff',
						'bool',
						'defaults to on',
						true
					),
				],
				( _, cgdb, id, onoff = true ) => this.mute( cgdb, id, onoff )
			)
		);

		// x32fade[type indicator, id, onoff]
		// channel with /ch/01..32/mix/fader
		// bus with /bus/01...16/mix/fader
		// dca with /dca/1...8/fader
		this.registerTrigger(
			new ModuleTrigger(
				'x32fade',
				'sets the fader for a channel, dca, or bus',
				[
					new ModuleTriggerArg( 'cdb', 'string', 'c, d, or b for channel, dca, or bus', false ),
					new ModuleTriggerArg(
						'id',
						'number',
						'id (starting from 1; 32 channels, 8 dca, 16 busses)',
						false
					),
					new ModuleTriggerArg(
						'pct',
						'number',
						'0-100 where 100 means +10db',
						true
					),
				],
				( _, cdb, id, pct ) => this.fader( cdb, id, pct )
			)
		);

		this.updateConfig( config );
	}

	updateConfig( config ) {
		super.updateConfig( config );
		this.host = config.host;
		if ( this.host && this.host != '' )
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
		this.oscPort = new osc.UDPPort( {
			localAddress: "0.0.0.0",
			remoteAddress: this.host,
			remotePort: this.port,
			metadata: true,
		} );

		this.oscPort.on( 'ready', () => this.connected = true );
		this.oscPort.on( 'error', this.handleError );
		this.oscPort.on( 'message', this.handleMessage );
		// this.oscPort.on( 'bundle', this.handleBundle );

		this.oscPort.open();
	}

	handleError( e ) {
		console.log( e );
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
		console.log( message );
		try {
			this.oscPort.send( message );
		} catch ( e ) {
			console.log( e );
		}
	}

	mute( cgdb, num, onoff ) {
		let address;
		num = num.toString();
		let value = onoff ? 0 : 1;
		switch ( cgdb ) {
			case 'c':
				address = `/ch/${num.padStart( 2, '0' )}/mix/on`;
				break;
			case 'g':
				address = `/config/mute/${num.padStart( 1, '0' )}`;
				value = onoff ? 1 : 0;
				break;
			case 'd':
				address = `/dca/${num.padStart( 1, '0' )}/on`;
				break;
			case 'b':
				address = `/bus/${num.padStart( 2, '0' )}/mix/on`;
				break;
		}
		if ( address ) {
			this.send( {
				address,
				args: [ {
					type: 'i',
					value,
				} ]
			} )
		}
	}
	fader( cdb, num, pct ) {
		let address;
		num = num.toString();
		let value = pct / 100; // convert the percentage to float
		switch ( cdb ) {
			case 'c':
				address = `/ch/${num.padStart( 2, '0' )}/mix/fader`;
				break;
			case 'd':
				address = `/dca/${num.padStart( 1, '0' )}/fader`;
				break;
			case 'b':
				address = `/bus/${num.padStart( 2, '0' )}/mix/fader`;
				break;
		}
		if ( address ) {
			this.send( {
				address,
				args: [ {
					value,
					type: 'f',
				} ]
			} )
		}
	}
}

module.exports.X32Controller = X32Controller;
