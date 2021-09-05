const got = require( 'got' );
const { Module, ModuleTrigger, ModuleTriggerArg } = require( './module' );

/* OLD VMIX TRIGGERS
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

*/

class VmixController extends Module {
  static name = 'vmix';
  static niceName = 'vMix Controller';
  static create( config ) {
    return new VmixController( config );
  }

  constructor ( config ) {
    super( config );
    this.updateConfig( config );

    this.lastmessage = '';
    this.enabled = true;

    this.onupdate = this.notify;

    // setup triggers
    this.registerTrigger(
      new ModuleTrigger(
        '~slideupdate~',
        'vMix Lyrics Handler (slide text => input text). This trigger runs on every slide update unless it sees "novmix" in the slide notes.',
        [],
        ( pro ) => {
          if ( pro.slides.current.notes.match( /novmix/ ) ) return;
          this.setInputText( this.default_title_input, pro.slides.current.text );
        }
      )
    );

    // vmixtrans[transition_type, [input name/number], [transition duration milliseconds]]
    // transition_type can be whatever transition vmix supports
    // second two arguments are optional
    // input defaults to whatever is set to Preview
    // transition defaults to 1000 milliseconds
    // const vmix_trans_pattern = /vmixtrans\[(\w+)\s*(?:,\s*(.+?))?\s*(?:,\s*(\d+))?\s*\]/gi;
    this.registerTrigger(
      new ModuleTrigger(
        'vmixtrans',
        'fires a vmix transition event',
        [
          new ModuleTriggerArg(
            'transition',
            'string',
            'can be any transition type vmix supports (Fade, Cut, etc.) (see the vmix documentation for more)',
            false
          ),
          new ModuleTriggerArg(
            'input',
            'number',
            'the number of the input to make live, defaults to whatever is Preview',
            true
          ),
          new ModuleTriggerArg(
            'duration',
            'number',
            'defaults to 1000 ms',
            true
          ),
        ],
        ( _, trans, input, duration ) =>
          this.transitionToInput( trans, input, duration )
      )
    );

    // vmixcut[input name/number]               ← shortcut to cut to an input (required)
    // const vmix_cut_pattern = /vmixcut\[(.+?)\s*\]/gi;
    this.registerTrigger(
      new ModuleTrigger(
        'vmixcut',
        'fires a vmix cut event',
        [
          new ModuleTriggerArg(
            'input',
            'number',
            'the number of the input to make live, defaults to whatever is Preview',
            true
          ),
        ],
        ( _, input ) => this.cutToInput( input )
      )
    );

    // vmixfade[input name/number, duration]    ← shortcut to fade to an input (duration optional)
    // const vmix_fade_pattern = /vmixfade\[(.+?)\s*(?:,\s*(\d+))?\s*\]/gi;
    this.registerTrigger(
      new ModuleTrigger(
        'vmixfade',
        'fires a vmix fade event',
        [
          new ModuleTriggerArg(
            'input',
            'number',
            'the number of the input to make live, defaults to whatever is Preview',
            true
          ),
          new ModuleTriggerArg(
            'duration',
            'number',
            'defaults to 1000 ms',
            true
          ),
        ],
        ( _, input, duration ) => this.fadeToInput( input, duration )
      )
    );

    // vmixtext[input name/number, [selected name/index], [textoverride]]
    // puts the current slide body text (or the textoverride) into the specified text box
    // of the specified input, selected name/index defaults to 0
    // const vmix_text_pattern = /vmixtext\[(.+?)\s*(?:,\s*(.+?))?\s*(?:,\s*(.+?))?\s*\]/gi;
    this.registerTrigger(
      new ModuleTrigger(
        'vmixtext',
        'updates the text on a vmix title',
        [
          new ModuleTriggerArg(
            'input',
            'number',
            'the number of the input containing the title to modify',
            false
          ),
          new ModuleTriggerArg(
            'selection',
            'string',
            'name or index of text box to update, defaults to 0',
            true
          ),
          new ModuleTriggerArg(
            'textoverride',
            'string',
            'defaults to the current slide body',
            true
          ),
        ],
        ( pro, input, selection = 0, override = null ) =>
          this.setInputText(
            input,
            override ?? pro.slides.current.text,
            selection
          )
      )
    );

    // vmixoverlay[overlay number, [In|Out|On|Off], [input number]]
    // sets an input as an overlay
    // overlay is required
    // type defaults to null which toggles the overlay using the default transition
    // input defaults to the currently selected input (Preview)
    // const vmix_overlay_pattern = /vmixoverlay\[(.+?)\s*(?:,\s*(.+?))?\s*(?:,\s*(.+?))?\s*\]/gi;
    this.registerTrigger(
      new ModuleTrigger(
        'vmixoverlay',
        'sets an input as an overlay, turning it on or off. If On or In, will wait duration ms and then disable again',
        [
          new ModuleTriggerArg(
            'overlay_number',
            'number',
            'which overlay slot do you want to use, defaults to 1',
            true
          ),
          new ModuleTriggerArg(
            'toggletype',
            'string',
            'In/Out do a transition, On/Off do a cut, defaults to a toggle using the default transition',
            true
          ),
          new ModuleTriggerArg(
            'input',
            'number',
            'the input to serve as the source of this overlay, defaults to the input currently on Preview',
            true
          ),
          new ModuleTriggerArg(
            'seconds_on',
            'number',
            'the number of seconds to leave this overlay on. defaults to infinite',
            true
          ),
        ],
        ( _, overlaynum = 1, toggletype = 0, input = null, seconds = null ) =>
          this.setOverlay( overlaynum, toggletype, input, seconds )
      )
    );

    // start streaming
    // const vmix_streaming_pattern = /vmixstream\[([10]|on|off)\]/gi;
    this.registerTrigger(
      new ModuleTrigger(
        'vmixstream',
        'controls vmix stream',
        [
          new ModuleTriggerArg(
            'onoff',
            'bool',
            'on or off (defaults to on)',
            false
          ),
          new ModuleTriggerArg(
            'stream_number',
            'number',
            '1 or 0 defaults to 0',
            false
          ),
        ],
        ( _, start = true, stream_number = 1 ) =>
          this.triggerStream( start, stream_number )
      )
    );

    // vmix script trigger
    this.registerTrigger(
      new ModuleTrigger(
        'vmixscript',
        'fires a vmix script',
        [
          new ModuleTriggerArg(
            'script_name',
            'string',
            'name of the script to execute',
            false
          ),
        ],
        ( _, script_name = '' ) =>
          this.scriptStart( script_name )
      )
    );

    // vmix dynamic value set
    this.registerTrigger(
      new ModuleTrigger(
        'vmixdv',
        'sets a vmix dynamic value',
        [
          new ModuleTriggerArg(
            'index',
            'number',
            'index of the dynamic value to change',
            false
          ),
          new ModuleTriggerArg(
            'value',
            'string',
            'value to set',
            false
          )
        ],
        ( _, index = 0, value = '' ) =>
          this.setDynamicValue( index, value )
      )
    );

    // For advanced vMix control, include the api url params here
    // vmix[urlencoded_params]
    // const vmix_advanced = /\[vmix\](.*?)\[\/vmix\]/gis;
    this.registerTrigger(
      new ModuleTrigger(
        'vmix',
        'takes a urlencoded string, and passes it to the vmix api unchanged',
        [
          new ModuleTriggerArg(
            'query',
            'string',
            'Function=Cut&Input=1&Duration=4000',
            false
          ),
        ],
        ( _, query = null ) => ( query == null ? null : this.send( query ) )
      )
    );


    // For advanced vMix control, put vMix API commands in JSON text between vmix tags
    // [vmixjson]
    // {
    // 	"Function": "Slide",
    // 	"Duration": 3000
    // }
    // [/vmixjson]
    // const vmix_advanced = /\[vmix\](.*?)\[\/vmix\]/gis;
    this.registerTrigger(
      new ModuleTrigger(
        'vmixjson',
        'sends commands directly to the vmix api after parsing them from a json string, can be a single object or an array',
        [
          new ModuleTriggerArg(
            'json_string',
            'json',
            '[{"Function": "SetDynamicValue1", "Value": "hello world"},{"Function": "Cut", "Input": 1, "Duration": 4000}]',
            false
          ),
        ],
        ( _, data = null ) => ( data == null ? null : this.api( data ) )
      )
    );
  }

  updateConfig( config ) {
    super.updateConfig( config );
    let { host, port, default_title_input } = config;
    this.endpoint = `http://${host}:${port}/api/?`;
    this.default_title_input = default_title_input;
  }

  notify( data ) {
    this.emit( 'update', data );
  }

  // returns a promise from "got"
  send( cmd ) {
    let url = `${this.endpoint}${cmd}`;
    console.log( `VMIX: ${url}` );
    this.onupdate( 'sending command' );
    return got( url )
      .then(
        ( res ) => {
          console.log( `VMIX RESPONSE:\n${res.requestUrl}\n${res.body}` );
          this.lastmessage = 'command successful';
          this.onupdate( this.lastmessage );
        },
        ( err ) => {
          // console.log(err);
          this.lastmessage = 'command failed';
          this.onupdate( this.lastmessage );
        }
      )
      .catch( ( err ) => {
        console.log( 'vmix request error' );
        this.lastmessage = 'error sending command';
        this.onupdate( this.lastmessage );
      } );
  }

  sendMultiple( queryList = [] ) {
    console.log( queryList );
    let promises = []
    for ( let query of queryList ) {
      promises.push( this.send( query ) )
    }
    return Promise.all( promises );
  }

  api( options ) {
    if ( Array.isArray( options ) ) {
      let promises = [];
      for ( let option of options ) promises.push( this.api( option ) );
      return Promise.all( promises );
    }

    let cmds = [];
    for ( let [ key, value ] of Object.entries( options ) ) {
      cmds.push( `${key}=${encodeURI( value )}` );
    }
    let cmd = cmds.join( '&' );
    return this.send( cmd );
  }

  // when input is null, we toggle between program and preview
  transitionToInput( transition = 'Cut', input = null, duration = 1000 ) {
    let options = { Function: transition };
    if ( input != null ) options.Input = input;
    if ( transition != 'Cut' ) options.Duration = duration;
    return this.api( options );
  }

  // when input is null, we toggle between program and preview
  fadeToInput( input = null, duration = 1000 ) {
    return this.transitionToInput( 'Fade', input, duration );
  }

  cutToInput( input = null ) {
    return this.transitionToInput( 'Cut', input );
  }

  transition( transition_type = 'Cut' ) {
    return this.transitionToInput( transition_type );
  }

  fade( duration = 1000 ) {
    return this.fadeToInput( null, duration );
  }

  cut() {
    return this.cutToInput( null );
  }

  // Dynamic Values are used in scripts
  setDynamicValue( index = 1, value = '' ) {
    let r = {
      Function: `SetDynamicValue${index}`,
      Value: value
    }
    return this.api( r );
  }

  async scriptStart( scriptName, dynamicValues = {} ) {
    if ( dynamicValues.length > 0 ) {
      for ( let k of Object.keys( dynamicValues ) ) {
        await this.setDynamicValue( k, dynamicValues[ k ] )
      }
    }
    return this.api( {
      Function: 'ScriptStart',
      Value: scriptName,
    } );
  }

  // selected can be a name or an index
  setInputText( input = null, text = '', selected = 0 ) {
    let r = {
      Function: 'SetText',
      Value: text,
    };
    if ( isNaN( +selected ) ) r.SelectedName = selected;
    else r.SelectedIndex = +selected;
    if ( input != null ) r.Input = input;
    return this.api( r );
  }

  // type can be In, Out, On, Off or nothing for toggle
  // In/Out do a transition, On/Off do a cut
  setOverlay( overlay = 1, type = '', input = null, seconds = null ) {
    if ( this.previousTimer ) clearTimeout( this.previousTimer );

    if ( isNaN( +overlay ) ) overlay = 1;
    let r = {
      Function: `OverlayInput${+overlay}${type}`,
    };
    if ( input != null ) r.Input = input;

    if ( seconds != null && ( type == 'In' || type == 'On' ) ) {
      let flipped;
      switch ( type ) {
        case 'In':
          flipped = 'Out';
          break;
        default:
          flipped = 'Off';
      }
      this.previousTimer = setTimeout(
        () => this.setOverlay( overlay, flipped, input ),
        seconds * 1000
      );
    }

    return this.api( r );
  }

  triggerStream( shouldStart = true, stream = 0 ) {
    return this.api( {
      Function: shouldStart ? 'StartStreaming' : 'StopStreaming',
      Value: stream,
    } );
  }
}

module.exports.VmixController = VmixController;
