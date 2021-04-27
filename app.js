// connects to ProPresenter 6 stage display (a websocket connection)
// listens for events
// runs triggers based on those events
// see the documentation below
'use strict';

const os = require( 'os' );
const path = require( 'path' );
const fs = require( 'fs' );

// ----- SETUP HAPPENS HERE ----------------
const HOME = os.homedir();
const CONF_FILE = path.join( HOME, '.config', 'pro-presenter-control.json' );

// app-level configuration file 
const config = require( './config.js' );
loadLocalConfigFile();

const { markdown } = require( './helpers.js' );
const { ModuleTrigger, ModuleTriggerArg, GlobalModule } = require( './modules/module.js' );

let Log = console.log;

// Object Extension to add a "clear" function on objects
Object.prototype.clear = function () {
	if ( Array.isArray( this ) )
		this.length = 0;
	else
		Object.keys( this ).forEach( k => delete this[ k ] );
}

// ----- MODULES AND TRIGGERS --------------

// available modules
// each module supports the same basic api:
//    static supports multiple?
//    static name
//    static create(options)                      // creates a new instance of this class from options
//    getInfo()                                   // reports instance id and trigger documentation
//    registerTrigger( ModuleTrigger() )          // registers a trigger exposed by this module
//    handleTrigger(tagname, args, onSuccess, onError)
// if a module supports multiple instances, the module must declare it so,
//
// modules must maintain their own connection to whatever it is they control


// Everything begins with ProPresenter, so it should always be instantiated
const { ProController } = require( './modules/pro.js' );

// Controller Modules for Known Products
const { VmixController } = require( './modules/vmix-controller.js' );
const { X32Controller } = require( './modules/x32-controller.js' );
const { JMLiveEventController } = require( './modules/jm-live-event-controller.js' );
const { CompanionController } = require( './modules/companion-controller.js' );
const { OscController } = require( './modules/osc-controller.js' );
const { MidiController } = require( './modules/midi-controller.js' );
const { OnyxController } = require( './modules/onyx-controller.js' );
const { OBSController } = require( './modules/obs-controller.js' );
const { HTTPController } = require( "./modules/http-controller.js" );

// arbitrary controllers for unknown products that support standard protocols
// const { TCPController } = require( "./modules/tcp-controller.js" );
// const { SocketIOController } = require( './modules/socketio-controller.js' );
// const { WebSocketController } = require( "./modules/websocket-controller.js" );

// put modules into various structures to make access easier

const modulesByName = {};
modulesByName[ ProController.name ] = ProController;
modulesByName[ VmixController.name ] = VmixController;
modulesByName[ X32Controller.name ] = X32Controller;
modulesByName[ JMLiveEventController.name ] = JMLiveEventController;
modulesByName[ CompanionController.name ] = CompanionController;
modulesByName[ OscController.name ] = OscController;
modulesByName[ MidiController.name ] = MidiController;
modulesByName[ OnyxController.name ] = OnyxController;
modulesByName[ OBSController.name ] = OBSController;
modulesByName[ HTTPController.name ] = HTTPController;
// modulesByName[ SocketIOController.name ] = SocketIOController;
// modulesByName[ WebSocketController.name ] = WebSocketController;
// modulesByName[ TCPController.name ] = TCPController;

const globalController = new GlobalModule();

// this will keep a registration of all the enabled and configured controllers
// each controller should expose its own commands and documentation
const configuredControllers = [];
const configuredControllersByUuid = {};

// create data structures to make it easier to access
// the triggers exposed by each controller
const configuredTriggers = [];
const configuredTriggersByUuid = {};

let allow_triggers = true;

let lower3 = {
	text: '',
	html: '',
	caption: '',
	image: config.LOWER3_IMAGE,
};

let pro; // this will become the top level master propresenter module when we initialize it

setGlobalTriggers();
registerAllConfigured();

// --------------------------------
// - ALL MODULES ARE NOW CONFIGURED
// --------------------------------
// TODO: CONVERT PRO NOTES TO USE NEW TRIGGERS
// [sermon_start] => log[SERMON STARTING]
// [sermon_end]   => log[SERMON ENDED]

// need to create pluggable triggers for other propresenter states
// need to create plugin system for additional modules

//  ---- UI SERVER CODE ---
const http = require( 'http' );
const url = require( 'url' );
const WebSocket = require( 'ws' );
const help = `
possible endpoints are the following:
/api/help ← return this text
/api/status ← return current status
/api/triggers ← returns a list of current triggers
/api/toggle/[trigger_uuid] ← toggles the status of a trigger
/api/toggle ← toggles the status of all trigger processing
`;

const server = http.createServer( httpHandler );

// handles realtime communication with frontend
const wss = new WebSocket.Server( {
	server: server,
	clientTracking: true,
} );

wss.on( 'connection', function connection( ws ) {
	ws.isAlive = true;

	ws.bettersend = function ( message = '', data = {} ) {
		let tosend = JSON.stringify( { message, data } );
		// console.log( 'sending:' );
		// console.log( tosend );
		ws.send( tosend );
	};

	// SETUP MESSAGE CHANNELS FROM THE FRONTEND
	ws.on( 'message', function incoming( raw_message ) {
		// to simulate socket.io
		// each "data" will be a JSON encoded dictionary
		// like this:
		// {'message': [string message], 'data': [submitted data]}
		console.log( 'received message from frontend' );
		console.log( raw_message );

		let { message, data } = JSON.parse( raw_message );
		switch ( message ) {
			case 'echo':
				broadcast( 'echo', data );
				break;
			case 'status':
				ws.bettersend( 'status', getStatus() );
				break;
			case 'pro_status':
				ws.bettersend( 'pro_status', getProStatus() );
				break;
			case 'full_status':
				ws.bettersend( 'full_status', getFullStatus() );
				break;
			case 'lower3':
				let status = getStatus();
				ws.bettersend( 'lower3', status.lower3 );
				break;
			case 'update_config':
				console.log( 'updating config' );
				for ( let key of Object.keys( config ) ) {
					if ( config[ key ] != data[ key ] ) config[ key ] = data[ key ];
				}
				Log( config );
				saveConfig();
				registerAllConfigured();
				broadcast( 'status', getStatus() );
				break;
			case 'update_controller_config':
				Log( 'updating controller config' );
				Log( data );
				if ( data.uuid && data.uuid in configuredControllersByUuid ) {
					let controller = configuredControllersByUuid[ data.uuid ];
					Log( 'BEFORE' );
					Log( controller.getInfo() );
					controller.updateConfig( data.config ); // TODO: flesh this out for each component
					Log( 'AFTER' );
					Log( controller.getInfo() );
				} else {
					// the frontend has created a new controller!
					Log( 'creating a new controller' );
				}
				saveConfig(); // should read the config from each component and not from the global config object
				// processConfig();
				// broadcast( 'status', getStatus() );
				break;
			case 'update_controller':
				console.log( 'updating controller status' );
				Log( data );
				if ( data.uuid in configuredControllersByUuid ) {
					let controller = configuredControllersByUuid[ data.uuid ];
					controller.enabled = data.enabled;
					for ( let t of data.triggers ) {
						if ( t.uuid in configuredTriggersByUuid ) {
							configuredTriggersByUuid[ t.uuid ].enabled = t.enabled;
						}
					}
				}
				broadcast( 'status', getStatus() );
				break;
			case 'update_trigger':
				console.log( 'updating trigger status' );
				Log( data );
				if ( data.uuid in configuredTriggersByUuid ) {
					configuredTriggersByUuid[ data.uuid ].enabled = data.enabled;
				}
				broadcast( 'status', getStatus() );
				break;

			// PROPRESENTER COMMANDS
			case 'trigger_slide':
				pro.remote.triggerSlide( data );
				break;
			case 'next_slide':
				pro.remote.next();
				break;
			case 'prev_slide':
				pro.remote.prev();
				break;
			case 'update_midi':
				console.log( 'selecting new MIDI port' );
				midi.closePort();
				midi.openPort( data );
				break;
			case 'toggle_allow_triggers':
				allow_triggers = data;
				broadcast( 'status', getStatus() );
				break;
		}
	} );
} );

// send keepalive pings
// const interval = setInterval(function ws_ping() {
// 	wss.clients.forEach(function each(ws) {
// 		if (ws.isAlive === false) return ws.terminate();
// 		ws.isAlive = false;
// 		ws.ping(noop);
// 	});
// }, 30000);

// and start the ui server
console.log( `
|
| ProPresenter Watcher
| UI available at http://localhost:${config.UI_SERVER_PORT}
|
`);
server.listen( config.UI_SERVER_PORT );


// PRIMARY FUNCTIONS
function broadcast( message, data ) {
	wss.clients.forEach( function each( ws ) {
		ws.send( JSON.stringify( { message, data } ) );
	} );
}

function setGlobalTriggers() {
	// special triggers on the "Global" module
	// triggers for for custom logging
	globalController.registerTrigger(
		new ModuleTrigger(
			'log',
			'sends a log event to the logger of the format: "LOGSTRING: timestamp"',
			[ new ModuleTriggerArg( 'string', 'string', 'string to log', true ) ],
			( _, s = '' ) => {
				if ( s != null && s != '' ) s += ': ';
				Log( s + timestamp() );
			}
		)
	);

	// special triggers for lower3 computations
	globalController.registerTrigger(
		new ModuleTrigger(
			'l3',
			'sets the lower third text',
			[
				new ModuleTriggerArg(
					'markdown_text',
					'string',
					'a string to be processed as markdown',
					false
				),
			],
			( _, markdown_text ) => {
				Log( markdown_text );
				lower3.text = markdown_text;
				lower3.html = markdown( markdown_text );
			}
		)
	);
	globalController.registerTrigger(
		new ModuleTrigger(
			'l3caption',
			'sets the lower third caption text',
			[
				new ModuleTriggerArg(
					'caption',
					'string',
					'stores data to a lower third caption field',
					true
				),
			],
			( _, caption ) => {
				lower3.caption = caption;
			}
		)
	);
}

function loadLocalConfigFile() {
	// user-level configuration file
	try {
		let jdata = fs.readFileSync( CONF_FILE );
		let localconf = JSON.parse( jdata );
		for ( let key of Object.keys( localconf ) ) {
			config[ key ] = localconf[ key ];
		}
	} catch ( e ) {
		console.log( `WARNING: Could not read local settings from ${CONF_FILE}` );
	}
}

// needs to process each component's config... not the global
// config object we started with
function saveConfig() {
	let dirname = path.dirname( CONF_FILE );
	let current = {};
	for ( let cm of configuredControllers ) {
		// Log( cm.getInfo() );
		if ( cm == globalController ) continue;

		// convert to array if another one by this key already exists
		if ( cm.moduleName in current ) {
			current[ cm.moduleName ] = [ current[ cm.moduleName ] ];
			current[ cm.moduleName ].push( cm.config );
		} else {
			current[ cm.moduleName ] = cm.config;
		}
	}
	config.controllers = current;

	fs.mkdir( dirname, { recursive: true }, ( err ) => {
		if ( err && err.code != 'EEXIST' ) {
			Log( `ERROR: Could not save settings to ${CONF_FILE}` );
			Log( err );
		} else {
			fs.writeFile( CONF_FILE, JSON.stringify( config, null, 2 ), 'utf8', ( err ) => {
				if ( err ) Log( err );
				else Log( `SUCCESS: Settings saved to ${CONF_FILE}` );
			} );
		}
	} );
}

function registerAllConfigured() {
	// ----- SETUP THE WEBLOGGER ------
	if ( config.USEWEBLOG ) {
		const WebLogger = require( './modules/web-logger.js' );
		let weblog = new WebLogger( config.LOGGER_URL, config.LOGGER_KEY );
		Log = function ( s, allowWebLog = true ) {
			if ( allowWebLog ) weblog.log( s );
			console.log( s );
		};
	}

	Log( 'Registering all configured controllers' );

	// since this might be the second time we have processed the configuration
	// we need to delete previously existing instances of controller modules
	// that means at the end of this, we will need to re-establish all event listeners
	for ( let mod of Object.values( modulesByName ) ) {
		if ( mod.instances ) {
			mod.instances.forEach( e => e.dispose() );
			mod.instances.length = 0;
		}
	}

	// reset the Controller and Trigger registrations
	configuredControllers.clear();
	configuredControllersByUuid.clear();
	configuredTriggers.clear();
	configuredTriggersByUuid.clear();

	// restore the global controller first
	registerControllerWithTriggers( globalController );

	// now, process the configuration and create all expected controllers
	// controller keys in the config file must match the static Module name of the controller
	for ( let k of Object.keys( config.controllers ) ) {
		if ( !k in modulesByName ) continue;
		let controllerModule = modulesByName[ k ];
		let coptions = config.controllers[ k ];
		let cm;
		if ( Array.isArray( coptions ) ) {
			for ( let instanceOptions of coptions ) {
				cm = new controllerModule( instanceOptions );
				cm.on( 'log', ( s ) => Log( s ) );
				registerControllerWithTriggers( cm );
			}
		} else {
			cm = new controllerModule( coptions );
			cm.on( 'log', ( s ) => Log( s ) );
			registerControllerWithTriggers( cm );
		}
	}
	// we now have a configured module for each of the controllers specified in the
	// configuration file. Each of them should have created their own instances by now
	// and each of them should manage their own lifecycle

	// // finally, reconnect ProPresenter Listeners
	pro = ProController.master;
	setupProListeners();
}

// takes a configured controller module and adds it to the
// configured controllers and triggers structures
function registerControllerWithTriggers( cm ) {
	configuredControllers.push( cm );
	configuredControllersByUuid[ cm.uuid ] = cm;
	for ( let trigger of cm.triggers ) {
		configuredTriggers.push( trigger );
		configuredTriggersByUuid[ trigger.uuid ] = trigger;
	}
}


// ----- PRO PRESENTER LISTENERS -----
function setupProListeners() {
	pro.removeAllListeners();

	pro.on( 'sysupdate', ( e ) => {
		Log( e );
		if ( allow_triggers ) fireTriggers( '~sysupdate~', [], pro );
		broadcast( 'sysupdate', e );
	} );

	pro.on( 'timersupdate', ( e ) => {
		Log( e );
		if ( e.uid == '47E8B48C-0D61-4EFC-9517-BF9FB894C8E2' ) {
			Log( `COUNTDOWN TIMER TRIGGERED:` );
			Log( e );
		}
		if ( allow_triggers ) fireTriggers( '~timersupdate~', [], pro );
		broadcast( 'timersupdate', e );
	} );

	pro.on( 'slideupdate', ( data ) => {
		Log( data );
		console.log( '--------- PRO SLIDE UPDATE -------------' );
		console.log( data );

		let foundTags = parseNotes( pro.slides.current.notes );
		Log( foundTags );

		// always update the lower3
		// later triggers might override this
		lower3.text = pro.slides.current.text;
		lower3.html = markdown( pro.slides.current.text );
		lower3.caption = '';


		// for each found tag, fire the matching triggers
		let used = false;
		if ( allow_triggers ) {
			for ( let { tag, args } of foundTags ) {
				used = fireTriggers( tag, args, pro ) || used;
			}
			used = fireTriggers( '~slideupdate~', [], pro ) || used;

			if ( !used ) {
				console.log( 'No triggers configured for this data:' );
				console.log( data );
			}
		} else {
			console.log( 'ProPresenter Update, but triggers are disabled.' );
		}
		console.log( '-----------------------------------' );

		broadcast( 'slideupdate', data );
		broadcast( 'status', getStatus() ); // contains lower3 data
		broadcast( 'pro_status', getProStatus() ); // contains proPresenter data
	} );

	// pass all events directly through to the frontend
	pro.on( 'sddata', ( data ) => broadcast( 'sddata', data ) );
	pro.on( 'sdupdate', ( data ) => broadcast( 'sdupdate', data ) );
	pro.on( 'msgupdate', ( data ) => broadcast( 'msgupdate', data ) );
	pro.on( 'remotedata', ( data ) => broadcast( 'remotedata', data ) );
	pro.on( 'remoteupdate', ( data ) => broadcast( 'remoteupdate', data ) );
}

function getStatus() {
	if ( lower3.text == '' && pro.slides.current.text != '' ) {
		lower3.text = pro.slides.current.text;
		lower3.html = pro.slides.current.text;
		lower3.caption = '';
	}
	return {
		config,
		allow_triggers,
		lower3,
		pro_connected: pro.connected,
	}
}

function getProStatus() {
	return pro.fullStatus();
}

function getFullStatus() {
	return {
		...getStatus(),
		pro_status: pro.fullStatus(),
		controllers: configuredControllers.map( ( e ) => e.getInfo() ),
		triggers: configuredTriggers.map( ( e ) => e.doc() ),
	};
}

function triggerStatus() {
	let retval = { allow_triggers, triggers: [] };
	for ( let i = 0; i < configuredTriggers.length; i++ ) {
		let t = configuredTriggers[ i ];
		let o = {
			doc: t.doc(),
			id: i,
		};
		retval.triggers.push( o );
	}
	return retval;
}
function fireTriggers( tagname, args = [], proInstance ) {
	let used = false;
	configuredTriggers.forEach( ( t ) => {
		if ( t.tagname == tagname ) {
			console.log( `TRIGGER: ${tagname}` );
			Log( t.doc() );
			used = t.fireIfEnabled( args, proInstance ) || used;
		}
	} );
	return used;
}

function makeTag( tag = '', type = 'short', args = [] ) {
	return { tag, type, args };
}

// takes a string and looks for all
// trigger codes of the formats:
//   [tag]content[/tag]
//   tag[arg1,arg2,arg3]
function parseNotes( s = '' ) {
	let retval = [];
	const longcode = /\[([^\s]+)\](.*?)\[\/\1\]/gis;

	for ( let found of findall( longcode, s ) ) {
		s = s.replace( found[ 0 ], '' );
		retval.push( makeTag( found[ 1 ], 'long', [ found[ 2 ] ] ) );
	}

	// because we want to support arbitrary strings in the shortcodes
	// they require a stream parser.
	let chars = s;
	let acc = [];
	let tag = '';
	let args = [];
	let in_args = false;
	let in_delimited_string = false;
	let delimiters = /(['"`])/;
	let delimiter = '';
	for ( let i = 0; i < chars.length; i++ ) {
		let char = chars[ i ];
		let m;
		if ( in_args ) {
			if ( in_delimited_string ) {
				if ( char == delimiter ) {
					in_delimited_string = false;
					let accumulated = acc.join( '' );
					accumulated = accumulated.replace( '\\n', '\n' );
					accumulated = accumulated.replace( '\\r', '\r' );
					accumulated = accumulated.replace( '\\t', '\t' );
					args.push( accumulated );
					acc = [];
					continue;
				}
				acc.push( char );
				continue;
			}

			m = char.match( delimiters );
			if ( m ) {
				delimiter = m[ 1 ];
				in_delimited_string = true;
				continue;
			}

			if ( char == ',' ) {
				args.push( acc.join( '' ).trim() );
				acc = [];
				continue;
			}

			if ( char == ']' ) {
				let leftover = acc.join( '' ).trim();
				acc = [];
				if ( leftover.length > 0 ) {
					args.push( leftover );
				}
				retval.push( makeTag( tag, 'short', args ) );
				in_args = false;
				args = [];
				tag = '';
				continue;
			}

			acc.push( char );
			continue;
		}

		if ( char == '[' ) {
			if ( acc.length > 0 ) {
				tag = acc.join( '' );
				acc = [];
				in_args = true;
				continue;
			}
		}

		// whitespace resets the accumulator outside of a tag or args list
		m = char.match( /\s/ );
		if ( m ) {
			acc = [];
			continue;
		}

		acc.push( char );
	}
	return retval;
}

function httpHandler( req, res ) {
	// console.log(req);
	if ( req.url.match( /\/api\// ) ) {
		let match;
		let output;

		// get help
		match = req.url.match( /\/api\/help\/?$/ );
		if ( match ) {
			res.writeHead( 200, { 'Content-type': 'text/plain;charset=UTF-8' } );
			res.end( help );
			return;
		} else {
			res.writeHead( 200, { 'Content-type': 'application/json;charset=UTF-8' } );
		}

		// get status
		match = req.url.match( /\/api\/status\/?$/ );
		if ( match ) {
			output = JSON.stringify( getStatus() );
		}
		match = req.url.match( /\/api\/pro_status\/?$/ );
		if ( match ) {
			output = JSON.stringify( getProStatus() );
		}
		match = req.url.match( /\/api\/full_status\/?$/ );
		if ( match ) {
			output = JSON.stringify( getFullStatus() );
		}

		// get all triggers
		match = req.url.match( /\/api\/triggers\/?$/ );
		if ( match ) {
			output = JSON.stringify( triggerStatus() );
		}

		match = req.url.match( /\/api\/toggle\/?$/ );
		if ( match ) {
			allow_triggers = !allow_triggers;
			output = JSON.stringify( triggerStatus() );
		}

		match = req.url.match( /\/api\/toggle\/([^\/]*)\/?$/ );
		if ( match ) {
			let uuid = match[ 1 ];
			if ( uuid in configuredTriggersByUuid )
				configuredTriggersByUuid[ uuid ].enabled = !configuredTriggersByUuid[ uuid ]
					.enabled;
			output = JSON.stringify( triggerStatus() );
		}
		res.end( output );
	} else {
		// does the request result in a real file?
		let pathName = url.parse( req.url ).pathname;
		if ( pathName == '/' ) pathName = '/index.html';
		console.log( pathName );
		fs.readFile( __dirname + '/ui' + pathName, function ( err, data ) {
			if ( err ) {
				res.writeHead( 404 );
				res.write( 'Page not found.' );
				res.end();
			} else {
				let header = {};
				if ( pathName.match( '.html' ) )
					header = { 'Content-type': 'text/html;charset=UTF-8' };
				if ( pathName.match( '.css' ) )
					header = { 'Content-type': 'text/css;charset=UTF-8' };
				res.writeHead( 200, header );
				res.write( data );
				res.end();
			}
		} );
	}
}

function findall( regex, subject ) {
	let matches = [];
	let match = true;
	while ( match ) {
		match = regex.exec( subject );
		if ( match ) {
			matches.push( match );
		}
	}
	return matches;
}

function timestamp() {
	let d = new Date();
	let year = d.getFullYear();
	let month = d.getMonth().toString().padStart( 2, '0' );
	let day = d.getDate().toString().padStart( 2, '0' );
	let hour = d.getHours().toString().padStart( 2, '0' );
	let min = d.getMinutes().toString().padStart( 2, '0' );
	let sec = d.getSeconds().toString().padStart( 2, '0' );
	return `${year}-${month}-${day} ${hour}:${min}:${sec}`;
}
