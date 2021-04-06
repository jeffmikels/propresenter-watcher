// connects to ProPresenter 6 stage display (a websocket connection)
// listens for events
// runs triggers based on those events
// see the documentation below
"use strict";

// ----- SETUP HAPPENS HERE ----------------

// general configuration
const config = require( "./config.js" );

// modules
const { Pro6Listener, Pro6Controller } = require( "./modules/pro6.js" );
const { LiveEventController } = require( "./modules/live-event-controller.js" );
const { VmixController } = require( "./modules/vmix-controller.js" );
const { CompanionController } = require( "./modules/companion-controller.js" );
const { Midi } = require( "./modules/midi.js" );
const { OnyxController } = require( "./modules/onyx.js" );

// const { WebSocketController } = require( "./modules/websocket.js" );
// const { OBSController } = require( "./modules/obs.js" );
// const { HTTPController } = require( "./modules/http.js" );


// web logger allows logging to a web service
let Log = console.log;
if ( config.USEWEBLOG ) {
	const WebLogger = require( "./modules/web-logger.js" );
	const weblog = new WebLogger( config.LOGGER_URL, config.LOGGER_KEY );
	Log = function ( s, allowWebLog = true ) {
		if ( allowWebLog ) weblog.log( s );
		console.log( s );
	};
}

// LIVE EVENT API HANDLER
let lec = new LiveEventController( config.LCC_LIVE_URL, 0 );

// VMIX API HANDLER
let vmix = new VmixController( "http://" + config.VMIX_HOST );
let vmix_lower3 = {
	text: "",
	html: "",
	caption: "",
	image: config.LOWER3_IMAGE,
};

// COMPANION API HANDLER
let companions = {};
for ( let name of Object.keys( config.COMPANION_HOSTS ) ) {
	companions[ name ] = new CompanionController( config.COMPANION_HOSTS[ name ] );
}

// MIDI HANDLER
let midi = new Midi();
if ( config.USEMIDI && config.MIDI_PORT ) midi.openPort( config.MIDI_PORT );

// ONYX HANDLER
let onyx;
if ( config.USEONYX ) onyx = new OnyxController( config.ONYX_IP, config.ONYX_PORT );

// global ProPresenterListener for future use;
let pl;

//
//
//
//
// (-- THIS IS WHERE THE MAGIC HAPPENS --)
//
//
//
//
// TRIGGERS
// triggers have the pattern
// {
//	name: 'Description of this trigger.',
// 	type: 'timer|slides|systime',
// 	test: function returning a boolean called with this data object,
// 	callback: function to call if there was a match (argument is the proper data object),
// }

// TRIGGERS REGEX DOCUMENTATION
// LIVE EVENTS:
// [sermon_start]          ← used to flag the web-logger, timers, or other things
// event[event_id]         ← requests control of an event
// live[progress_integer]  ← sends progress to the event as an integer
const sermon_start_pattern = /\[sermon_start\]/i;
const live_event_pattern = /event\[(\d+)\]/i;
const live_progress_pattern = /live\[(\d+)\]/i;

// VMIX:
// [novmix] ← if found on a slide, no vmix triggers will be processed for that slide
const vmix_ignore_pattern = /\[novmix\]/i;

// vmix[transition_type, [input name/number], [transition duration milliseconds]]
// transition_type can be whatever transition vmix supports
// second two arguments are optional
// input defaults to whatever is set to Preview
// transition defaults to 1000 milliseconds
const vmix_trans_pattern = /vmix\[(\w+)\s*(?:,\s*(.+?))?\s*(?:,\s*(\d+))?\s*\]/gi;

// vmixcut[input name/number]               ← shortcut to cut to an input (required)
const vmix_cut_pattern = /vmixcut\[(.+?)\s*\]/gi;

// vmixfade[input name/number, duration]    ← shortcut to fade to an input (duration optional)
const vmix_fade_pattern = /vmixfade\[(.+?)\s*(?:,\s*(\d+))?\s*\]/gi;

// vmixtext[input name/number, [selected name/index], [textoverride]]
// puts the current slide body text (or the textoverride) into the specified text box
// of the specified input, selected name/index defaults to 0
const vmix_text_pattern = /vmixtext\[(.+?)\s*(?:,\s*(.+?))?\s*(?:,\s*(.+?))?\s*\]/gi;

// vmixoverlay[overlay number, [In|Out|On|Off], [input number]]
// sets an input as an overlay
// overlay is required
// type defaults to null which toggles the overlay using the default transition
// input defaults to the currently selected input (Preview)
const vmix_overlay_pattern = /vmixoverlay\[(.+?)\s*(?:,\s*(.+?))?\s*(?:,\s*(.+?))?\s*\]/gi;

// manually set the vmix lower3 html.
const vmix_lower3_pattern = /\[l3\](.*?)\[\/l3\]/gis;
const vmix_lower3caption_pattern = /\[l3caption\](.*?)\[\/l3caption\]/gis;

// start streaming
const vmix_streaming_pattern = /vmixstream\[([10]|on|off)\]/gi;

// For advanced vMix control, put vMix API commands in JSON text between vmix tags
// [vmix]
// {
// 	"Function": "Slide",
// 	"Duration": 3000
// }
// [/vmix]
const vmix_advanced = /\[vmix\](.*?)\[\/vmix\]/gis;

// NOTE: vMix API Documentation is here:
// https://www.vmix.com/help21/index.htm?DeveloperAPI.html
// https://www.vmix.com/help19/index.htm?ShortcutFunctionReference.html
// NOTE: multiple vmix triggers of each type can be handled per slide.

// COMPANION:
// companionbutton[page number, button/bank number]
const companion_button_pattern = /companionbutton\[\s*(.+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]/gi;

// companionpage[page number, surface id]
const companion_page_pattern = /companionpage\[\s*(.+)\s*,\s*(\d+)\s*,\s*(.+)\s*\]/gi;

// MIDI:
// note[note,[velocity],[channel]]
// channel defaults to 0
// velocity defaults to 127
const midi_note_pattern = /note\[(\d+)\s*(?:,\s*(\d+?))?\s*(?:,\s*(\d+))?\s*\]/gi;

// pc[program number, [channel]]
// program change, channel defaults to 0
const midi_pc_pattern = /pc\[(\d+)\s*(?:,\s*(\d+?))?\s*\]/gi;

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

// mtc[initial timecode string, fps]
// timecode string should be of the format HH:MM:SS:FF where FF is the number of the frame, zero indexed
// fps is frames per second... defaults to 24
// mtc[] will turn off the timecode generator
const midi_mtc_pattern = /mtc\[(?:(.+?))?\s*(?:,\s*(\d+))?\s*\]/gi;

// onyx patterns
const onyx_go_pattern = /onyxgo\[(.+?)\s*(?:,\s*(\d+))?\s*\]/gi;
const onyx_release_pattern = /onyxrelease\[(.+?)\s*(?:,\s*(\d+))?\s*\]/gi;

let allow_triggers = true;
const pro6_triggers = [
	{
		name: "Testing Timer Trigger",
		type: "timer",
		enabled: true,
		test: ( d ) => d.uid == "47E8B48C-0D61-4EFC-9517-BF9FB894C8E2",
		callback: ( d ) => {
			Log( `COUNTDOWN TIMER TRIGGERED:` );
			Log( d );
		},
	},
	{
		name: "SlideNotes MIDI Checker",
		type: "slides",
		enabled: true,
		test: () => config.USEMIDI,
		callback: ( slides ) => {
			if ( !midi.connected ) {
				console.log( "MIDI triggered, but no MIDI port is connected" );
			}

			// check current slide notes for midi note data
			for ( let match of findall( midi_note_pattern, slides.current.notes ) ) {
				let note = match[ 1 ];
				let vel = match[ 2 ] || 127;
				let chan = match[ 3 ] || 0;
				// the "hit" function will turn a note on and then off again after 100ms
				midi.hit( note, vel, chan );
			}

			// check current slide notes for midi program data
			for ( let match of findall( midi_pc_pattern, slides.current.notes ) ) {
				let prog = match[ 1 ];
				let chan = match[ 2 ] || 0;
				midi.program( prog, chan );
			}

			// check current slide notes for midi control change data
			for ( let match of findall( midi_cc_pattern, slides.current.notes ) ) {
				let controller = match[ 1 ];
				let val = match[ 2 ] || 127;
				let chan = match[ 3 ] || 0;
				midi.control( controller, val, chan );
			}

			// check current slide notes for midi control change data
			for ( let match of findall( midi_mtc_pattern, slides.current.notes ) ) {
				let timecode = match[ 1 ];
				let fps = match[ 2 ] || 24;
				if ( timecode ) midi.mtcStart( timecode, fps );
				else midi.mtcStop();
			}
		},
	},
	{
		name: "SlideNotes Sermon Start Checker",
		type: "slides",
		enabled: true,
		test: () => true,
		callback: ( slides ) => {
			let match;

			// check current notes for live event data
			match = slides.current.notes.match( sermon_start_pattern );
			if ( match ) {
				let now = new Date();
				Log( "SERMON STARTING: " + timestamp() );
			}
		},
	},
	{
		name: "SlideNotes Live Event Checker",
		type: "slides",
		enabled: true,
		test: () => true,
		callback: ( slides ) => {
			let match;

			// check current notes for live event data
			match = slides.current.notes.match( live_event_pattern );
			if ( match ) {
				lec.control( match[ 1 ] );
				let logstring = "LIVE EVENT CONTROL: event " + match[ 1 ];
				Log( logstring );
			}

			match = slides.current.notes.match( live_progress_pattern );
			if ( match ) {
				let progress = match[ 1 ];
				lec.update( progress );
				let logstring = `LIVE EVENT UPDATE: event ${lec.eid} progress ${progress}`;
				Log( logstring );
				if ( progress == 999 )
					setTimeout( () => {
						lec.update( 0 );
						Log( "automatically resetting event" );
					}, 60 * 1000 );
			}
		},
	},
	{
		name: `vMix Lyrics Handler (slide text => input ${config.VMIX_LYRICS_INPUT})`,
		type: "slides",
		enabled: true,
		test: () => true,
		callback: ( slides ) => {
			// check current notes for novmix tag
			let match;
			match = slides.current.notes.match( vmix_ignore_pattern );
			if ( match ) {
				Log( "[novmix] found... ignoring vmix commands" );
				return;
			}
			vmix.setInputText( config.VMIX_LYRICS_INPUT, slides.current.text );
		},
	},
	{
		name: "vMix Automation Checker (transitions, overlays, text, streaming, advanced)",
		type: "slides",
		enabled: true,
		test: () => true,
		callback: ( slides ) => {
			// check current notes for novmix tag
			let match;
			match = slides.current.notes.match( vmix_ignore_pattern );
			if ( match ) {
				Log( "[novmix] found... ignoring vmix commands" );
				return;
			}

			// fade trigger
			match = true;
			while ( match ) {
				match = vmix_fade_pattern.exec( slides.current.notes );
				if ( match ) {
					Log( `vmix match: ${match[ 0 ]}` );
					let duration = 1000;
					if ( match[ 2 ] ) duration = +match[ 2 ];
					vmix.fadeToInput( match[ 1 ], duration );
				}
			}

			// cut trigger
			match = true;
			while ( match ) {
				match = vmix_cut_pattern.exec( slides.current.notes );
				if ( match ) {
					Log( `vmix match: ${match[ 0 ]}` );
					vmix.cutToInput( match[ 1 ] );
				}
			}

			// generic transition trigger
			match = true;
			while ( match ) {
				match = vmix_trans_pattern.exec( slides.current.notes );
				if ( match ) {
					Log( `vmix match: ${match[ 0 ]}` );
					let type = match[ 1 ].toLowerCase();
					type = type.charAt( 0 ).toUpperCase() + type.slice( 1 );
					let input = null;
					if ( match[ 2 ] ) input = match[ 2 ];
					let duration = 1000;
					if ( match[ 3 ] ) duration = +match[ 3 ];
					let options = {
						Function: type,
						Duration: duration,
					};
					if ( input ) options.Input = input;
					vmix.api( options );
				}
			}

			// overlay trigger
			match = true;
			while ( match ) {
				match = vmix_overlay_pattern.exec( slides.current.notes );
				if ( match ) {
					Log( `vmix match: ${match[ 0 ]}` );
					let overlay = match[ 1 ];
					let type = match[ 2 ] ? match[ 2 ] : null;
					let input = match[ 3 ] ? match[ 3 ] : null;
					vmix.setOverlay( overlay, type, input );
				}
			}

			// text trigger
			match = true;
			while ( match ) {
				match = vmix_text_pattern.exec( slides.current.notes );
				if ( match ) {
					Log( `vmix match: ${match[ 0 ]}` );
					let selected = 0;
					if ( match[ 2 ] ) selected = match[ 2 ];
					let realtext = slides.current.text;
					if ( match[ 3 ] ) realtext = match[ 3 ];
					if ( !used_override ) {
						vmix_lower3.text = realtext;
						vmix_lower3.html = realtext;
					}
					vmix.setInputText( match[ 1 ], realtext, selected );
				}
			}

			// streaming trigger
			match = true;
			while ( match ) {
				match = vmix_streaming_pattern.exec( slides.current.notes );
				if ( match ) {
					Log( `vmix match: ${match[ 0 ]}` );
					let onoff = match[ 1 ];
					if ( onoff == "on" || onoff == "1" ) vmix.triggerStream( true );
					else vmix.triggerStream( false );
				}
			}

			// allow for advanced vmix commands
			match = true;
			while ( match ) {
				match = vmix_advanced.exec( slides.current.notes );
				if ( match && match[ 1 ] ) {
					Log( `vmix match: ${match[ 0 ]}` );
					let options = JSON.parse( match[ 1 ] );
					if ( options ) vmix.api( options );
				}
			}
		},
	},
	{
		name: `vMix Lower Thirds Checker `,
		type: "slides",
		enabled: true,
		test: () => true,
		callback: ( slides ) => {
			// check current notes for novmix tag
			let match;
			match = slides.current.notes.match( vmix_ignore_pattern );
			if ( match ) {
				Log( "[novmix] found... ignoring vmix commands" );
				return;
			}

			// set default lower3 text always
			vmix_lower3.text = slides.current.text.trim();
			vmix_lower3.html = markdown( slides.current.text.trim() );
			vmix_lower3.caption = ''


			match = true;
			let used_override = false;
			while ( match ) {
				match = vmix_lower3_pattern.exec( slides.current.notes );
				if ( match ) {
					// console.log(match);
					used_override = true;
					Log( `vmix lower3 override: ${match[ 0 ]}` );
					vmix_lower3.text = match[ 1 ].trim();
					vmix_lower3.html = markdown( match[ 1 ].trim() );
				}
			}

			match = true;
			while ( match ) {
				match = vmix_lower3caption_pattern.exec( slides.current.notes );
				if ( match ) {
					// console.log(match);
					Log( `vmix lower3 caption: ${match[ 0 ]}` );
					vmix_lower3.caption = markdown( match[ 1 ].trim() );
				}
			}
		},
	},
	{
		name: "Onyx Notes Checker",
		type: "slides",
		enabled: true,
		test: () => true,
		callback: ( slides ) => {
			let match;

			match = true;
			while ( match ) {
				match = onyx_go_pattern.exec( slides.current.notes );
				if ( match ) {
					Log( `onyx match: ${match[ 0 ]}` );
					let cuelist = match[ 1 ];
					let cue = match[ 2 ] ? match[ 2 ] : null;
					onyx.goCuelist( cuelist, cue );
				}
			}

			match = true;
			while ( match ) {
				match = onyx_release_pattern.exec( slides.current.notes );
				if ( match ) {
					Log( `onyx match: ${match[ 0 ]}` );
					let cuelist = match[ 1 ];
					let cue = match[ 2 ] ? match[ 2 ] : null;
					onyx.releaseCuelist( cuelist, cue );
				}
			}
		},
	},
	{
		name: "Companion Notes Checker",
		type: "slides",
		enabled: true,
		test: () => true,
		callback: ( slides ) => {
			let match = true;
			while ( match ) {
				match = companion_button_pattern.exec( slides.current.notes );
				if ( match && match[ 1 ] && match[ 2 ] && match[ 3 ] ) {
					let host = match[ 1 ];
					console.log( host );
					Log( `companion button press match: ${match[ 0 ]}` );
					companions[ host ].buttonPress( match[ 2 ], match[ 3 ] );
				}
			}

			match = true;
			while ( match ) {
				match = companion_page_pattern.exec( slides.current.notes );
				if ( match && match[ 1 ] && match[ 2 ] && match[ 3 ] ) {
					let host = match[ 1 ];
					console.log( host );
					Log( `companion page select match: ${match[ 0 ]}` );
					companions[ host ].pageSelect( match[ 2 ], match[ 3 ] );
				}
			}
		},
	},
];

//
// NO NEED TO EDIT BELOW HERE
//
//  ---- UI SERVER CODE ---
const fs = require( "fs" );
const http = require( "http" );
const url = require( "url" );
const WebSocket = require( "ws" );
const help = `
possible endpoints are the following:
/api/help ← return this text
/api/triggers ← returns a list of current triggers
/api/toggle/trigger_id ← toggles the status of a trigger
/api/toggle ← toggles the status of all trigger processing
`;

const server = http.createServer( httpHandler );

// handles realtime communication with frontend
const wss = new WebSocket.Server( {
	server: server,
	clientTracking: true,
} );

wss.on( "connection", function connection( ws ) {
	ws.isAlive = true;

	ws.bettersend = function ( message = "", data = {} ) {
		ws.send( JSON.stringify( { message, data } ) );
	};

	ws.on( "message", function incoming( raw_message ) {
		// to simulate socket.io
		// each "data" will be a JSON encoded dictionary
		// like this:
		// {'message': [string message], 'data': [submitted data]}
		console.log( "received: message" );
		console.log( raw_message );

		var json = JSON.parse( raw_message );
		var message = json.message;
		var data = json.data;
		vmix.onupdate = ( s ) => {
			broadcast( "vmix", vmix.lastmessage );
		};
		switch ( message ) {
			case "echo":
				broadcast( "echo", data );
				break;
			case "status":
				ws.bettersend( "status", getStatus() );
				break;
			case "lower3":
				let status = getStatus();
				ws.bettersend( "lower3", status.lower3 );
				break;
			case "config":
				console.log( "updating config" );
				for ( let key of Object.keys( config ) ) {
					if ( config[ key ] != data[ key ] ) config[ key ] = data[ key ];
				}
				if ( pl ) {
					pl.host = config.PRO6_HOST;
					pl.password = config.PRO6_SD_PASSWORD;
					if ( pl.connected ) pl.ws.close();
					pl.connect();
				}
				broadcast( "status", getStatus() );
				break;
			case "update_triggers":
				console.log( "updating triggers" );
				for ( let i = 0; i < data.length; i++ ) {
					pro6_triggers[ i ].enabled = data[ i ].enabled;
				}
				broadcast( "status", getStatus() );
				break;
			case "update_midi":
				console.log( "selecting new MIDI port" );
				midi.closePort();
				midi.openPort( data );
				break;
			case "toggle_allow_triggers":
				allow_triggers = data;
				broadcast( "status", getStatus() );
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

// finally, initialize the ProPresenter Connection
// setup ProPresenter Listener
pl = new Pro6Listener( config.PRO6_HOST, config.PRO6_SD_PASSWORD, {
	onsysupdate: ( e ) => {
		// console.log(e);
	},
	onslideupdate: ( e ) => {
		// console.log(e);
	},
	ontimersupdate: ( e ) => {
		// console.log(e);
	},
	onupdate: ( data, pro6 ) => {
		// console.log("SYSTEM: ");
		// console.log(pro6.system_time);
		// console.log("TIMERS: ");
		// console.log(pro6.timers);
		// console.log("SLIDES: ");
		// console.log(pro6.slides);

		console.log( "--------- PRO6 UPDATE -------------" );
		console.log( data );
		broadcast( "pro6update", data );

		// process triggers
		let used = false;
		if ( allow_triggers ) {
			for ( let trigger of pro6_triggers ) {
				if ( trigger.enabled && trigger.type == data.type && trigger.test( data.data ) ) {
					console.log( `TRIGGER: ${trigger.name}` );
					trigger.callback( data.data );
					used = true;
				}
			}
			if ( !used ) {
				console.log( "No triggers configured, for this data:" );
				console.log( data );
			}
		} else {
			console.log( "ProPresenter Update, but triggers are disabled." );
			// console.log(data);
		}
		console.log( "-----------------------------------" );

		broadcast( "status", getStatus() );
	},
} );

// and start the ui server
console.log( `
|
| ProPresenter Watcher
| UI available at http://localhost:${config.UI_SERVER_PORT}
|
`);
server.listen( config.UI_SERVER_PORT );

// OTHER FUNCTIONS
function noop() { }
function getStatus() {
	if ( vmix_lower3.text == "" && pl.slides.current.text != "" ) {
		vmix_lower3.text = pl.slides.current.text;
		vmix_lower3.html = pl.slides.current.text;
		vmix_lower3.caption = pl.slides.current.caption;
	}
	return {
		config,
		allow_triggers,
		triggers: pro6_triggers,
		pro6_status: pl.status(),
		vmix_status: vmix.lastmessage,
		midi_status: midi.status(),
		lower3: vmix_lower3,
	};
}
function broadcast( message, data ) {
	wss.clients.forEach( function each( ws ) {
		ws.send( JSON.stringify( { message, data } ) );
	} );
}
function triggerStatus() {
	let retval = { allow_triggers, triggers: [] };
	for ( let i = 0; i < pro6_triggers.length; i++ ) {
		let t = pro6_triggers[ i ];
		let o = {
			name: t.name,
			description: t.description,
			enabled: t.enabled,
			id: i,
		};
		retval.triggers.push( o );
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
			res.writeHead( 200, { "Content-type": "text/plain;charset=UTF-8" } );
			res.end( help );
			return;
		} else {
			res.writeHead( 200, { "Content-type": "application/json;charset=UTF-8" } );
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

		match = req.url.match( /\/api\/toggle\/(\d*)\/?$/ );
		if ( match ) {
			let id = +match[ 1 ];
			if ( id < pro6_triggers.length && id >= 0 ) {
				pro6_triggers[ id ].enabled = !pro6_triggers[ id ].enabled;
			}
			output = JSON.stringify( triggerStatus() );
		}
		res.end( output );
	} else {
		// does the request result in a real file?
		let pathName = url.parse( req.url ).pathname;
		if ( pathName == "/" ) pathName = "/index.html";
		console.log( pathName );
		fs.readFile( __dirname + "/ui" + pathName, function ( err, data ) {
			if ( err ) {
				res.writeHead( 404 );
				res.write( "Page not found." );
				res.end();
			} else {
				let header = {};
				if ( pathName.match( ".html" ) ) header = { "Content-type": "text/html;charset=UTF-8" };
				if ( pathName.match( ".css" ) ) header = { "Content-type": "text/css;charset=UTF-8" };
				res.writeHead( 200, header );
				res.write( data );
				res.end();
			}
		} );
	}
}

function markdown( s ) {
	s = s.replace( /_(.*?)_/g, `<span class="blank">$1</span>` );
	return s;
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
	let month = d.getMonth().toString().padStart( 2, "0" );
	let day = d.getDate().toString().padStart( 2, "0" );
	let hour = d.getHours().toString().padStart( 2, "0" );
	let min = d.getMinutes().toString().padStart( 2, "0" );
	let sec = d.getSeconds().toString().padStart( 2, "0" );
	return `${year}-${month}-${day} ${hour}:${min}:${sec}`;
}
