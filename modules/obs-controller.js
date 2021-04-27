const OBSWebSocket = require( 'obs-websocket-js' );
const { Module, ModuleTrigger, ModuleTriggerArg } = require( './module' );

// NOTE: OBS WebSocket Documentation is here:
// https://www.npmjs.com/package/obs-websocket-js
// https://github.com/Palakis/obs-websocket

class OBSController extends Module {
  static name = 'obs';
  static niceName = 'OBS Controller';
  static create( config ) {
    return new OBSController( config );
  }

  constructor ( config ) {
    super( config );

    this.obs = new OBSWebSocket();
    this.studioMode = false;

    // remember sources and scenes so we don't
    // need to make requests all the time
    // (keyed by source name)
    this.sources = {};
    this.scenes = {};
    this.currentSceneName = '';
    this.previewSceneName = '';

    // triggers and functions needed
    /*

    TODO: Allow the use of numbers to refer to scenes and scene items
    TODO: use catch on all this.obs.send commands !!!

    TRIGGERS:
      [x] ~slideupdate~ -> this.setSourceText(...);
      [x] obs['jsonstring'] -> this.api
      [x] obsstream[onoff] -> this.setStream(onoff)
      [x] obsrecord[onoff] -> this.setRecord(onoff)
      [x] obsoutput[output?,onoff] -> this setOutput(output)
      [x] obstext[sourcename,text] -> this setSourceText()
      [x] obspreview[scene] -> this.setPreview()
      [x] obscut[scene?] -> this.cutToScene()
      [x] obsfade[scene?,duration?] -> this.fadeToScene()
      [x] obstransition[scene?,transition?,duration?] -> this.transitionToScene();
      [x] obsmute[source,onoff] -> this.setSourceMute()

      // using SetSceneItemRender
      [x] obsactivate[sourcename, onoff, scenename?] -> this.setSourceActive
    	
      note:
        modifying a Source will show up everywhere that source shows up, but
        in studio mode modifying a SceneItem does not change the Program
        so call SetCurrentScene after modifying a SceneItem if you want
        the changes to show up immediately

        update the sceneItem
        if studio mode
          get current preview and program
          if sceneItem was changed in program
            do SetCurrentScene (will copy program to preview)
            set previous preview back to preview
      	
    */

    // setup triggers
    this.registerTrigger(
      new ModuleTrigger(
        '~slideupdate~',
        `Will update a text source identified by default_title_source in the configuration on every slide update unless the slide notes contain "noobs"`,
        [],
        ( pro ) => {
          if ( pro.slides.current.notes.match( /noobs/ ) ) return;
          this.setSourceText(
            this.default_title_source,
            pro.slides.current.text
          );
        }
      )
    );

    // For advanced OBS control, put OBS WebSocket commands in JSON text between obs tags
    // will be passed directly to obs.send like this:
    // obs.send(key, value)
    // [obs]
    // {
    // 	"SetCurrentSource": {
    // 	 "scene-name": "Live Broadcast"
    //  }
    // }
    // [/obs]
    this.registerTrigger(
      new ModuleTrigger(
        'obs',
        'sends commands directly to the obs api ',
        [
          new ModuleTriggerArg(
            'json_string',
            'json',
            '{"SetCurrentScene": {"scene-name": "Live Broadcast"}}',
            false
          ),
        ],
        ( _, data = null ) => ( data == null ? null : this.multiSend( data ) )
      )
    );

    this.registerTrigger(
      new ModuleTrigger(
        'obsstream',
        'toggles the obs stream on or off, leave blank to just toggle',
        [ new ModuleTriggerArg( 'onoff', 'bool', '', true ), ],
        ( _, onoff = null ) => ( this.setStreaming( onoff ) )
      )
    );

    this.registerTrigger(
      new ModuleTrigger(
        'obsrecord',
        'toggles the obs recording on or off, leave blank to just toggle',
        [ new ModuleTriggerArg( 'onoff', 'bool', '', true ), ],
        ( _, onoff = null ) => ( this.setRecording( onoff ) )
      )
    );

    this.registerTrigger(
      new ModuleTrigger(
        'obsoutput',
        'sets the obs output on or off, default is "on"',
        [
          new ModuleTriggerArg( 'outputname', 'string', '', false ),
          new ModuleTriggerArg( 'onoff', 'bool', '', true ),
        ],
        ( _, outputname, onoff = true ) => ( this.setOutput( outputname, onoff ) )
      )
    );

    this.registerTrigger(
      new ModuleTrigger(
        'obstext',
        'sets the text of a source',
        [
          new ModuleTriggerArg( 'sourcename', 'string', '', false ),
          new ModuleTriggerArg( 'text', 'string', '', true ),
        ],
        ( _, source, text = '' ) => ( this.setSourceText( source, text ) )
      )
    );

    this.registerTrigger(
      new ModuleTrigger(
        'obspreview',
        'sets the obs scene to preview. No effect unless studio mode.',
        [
          new ModuleTriggerArg( 'scene', 'string', '', false ),
        ],
        ( _, scene ) => ( this.setPreviewScene( scene ) )
      )
    );

    this.registerTrigger(
      new ModuleTrigger(
        'obscut',
        'cuts to a specific scene, defaults to whatever is preview',
        [
          new ModuleTriggerArg( 'scenename', 'string', '', false ),
        ],
        ( _, scene ) => ( this.cutToScene( scene ) )
      )
    );

    this.registerTrigger(
      new ModuleTrigger(
        'obsfade',
        'fades to a specific scene, defaults to whatever is preview',
        [
          new ModuleTriggerArg( 'scenename', 'string', '', true ),
          new ModuleTriggerArg( 'duration', 'number', 'in milliseconds', true ),
        ],
        ( _, scene, duration ) => ( this.fadeToScene( scene, duration ) )
      )
    );

    this.registerTrigger(
      new ModuleTrigger(
        'obstransition',
        'transition to specific scene with specific transition and duration, defaults to whatever is in preview',
        [
          new ModuleTriggerArg( 'scenename', 'string', '', true ),
          new ModuleTriggerArg( 'transition', 'string', '"Fade" or "Cut" or something else', true ),
          new ModuleTriggerArg( 'duration', 'number', 'in milliseconds', true ),
        ],
        ( _, scene = null, transition = null, duration = null ) => ( this.transitionToScene( scene, transition, duration ) )
      )
    );

    this.registerTrigger(
      new ModuleTrigger(
        'obsmute',
        'mutes a specific source, defaults to toggle',
        [
          new ModuleTriggerArg( 'source', 'string', '', false ),
          new ModuleTriggerArg( 'onoff', 'bool', 'turn mute on or off', true ),
        ],
        ( _, source, onoff = null ) => ( this.setSourceMute( source, onoff ) )
      )
    );

    this.registerTrigger(
      new ModuleTrigger(
        'obsvisible',
        'toggles visibility of a specific scene item, defaults to toggle',
        [
          new ModuleTriggerArg( 'source', 'string', '', false ),
          new ModuleTriggerArg( 'onoff', 'bool', 'turn source on or off', true ),
          new ModuleTriggerArg( 'scene', 'bool', 'scene in which to toggle, defaults to current scene', true ),
        ],
        ( _, source, onoff = null, scene = null ) => ( this.setSceneItemRender( source, onoff, scene ) )
      )
    );

    this.updateConfig( config );
  }

  updateConfig( config ) {
    super.updateConfig( config );
    let { host, port, password } = config;
    this.host = host;
    this.port = port;
    this.password = password;
    this.default_title_source = config.default_title_source ?? 'Lyrics';
    this.connect();
  }

  getInfo() {
    let r = { ...super.getInfo(), ...this.getStatus() };
    return r;
  }

  getStatus() {
    let r = {}
    r.studioMode = this.studioMode;
    r.currentSceneName = this.currentSceneName;
    r.previewSceneName = this.previewSceneName;
    r.defaultTransition = this.defaultTransition;
    r.defaultTransitionDuration = this.defaultTransitionDuration;
    r.sources = this.sources;
    r.scenes = this.scenes;

    return r;
  }


  async connect() {
    console.log( 'INFO: connecting to obs' )
    if ( this.obs.connected ) this.obs.disconnect();

    this.connected = false;
    let address = `${this.host}:${this.port}`;
    let password = this.password;
    this.obs
      .connect( { address, password } )
      .then( () => {
        this.connected = true;

        this.on( 'SwitchScenes', ( d ) => ( this.currentSceneName = d.sceneName ) );
        this.on( 'ScenesChanged', ( arr ) => this.updateScenes( arr ) );
        this.on( 'SourceRenamed', ( d ) => this.renameSource( d ) );

        // not implemented, but might be useful
        // this.on( 'SourceCreated', ( d ) => this.handleSourceCreated(d) );
        // this.on( 'SourceDestroyed', ( d ) => this.handleSourceDestroyed(d) );

        return this.getOBSStatus();
      } )
      .then( () => { this.emit( 'connected' ) } )
      .catch( ( err ) => {
        // Promise convention dicates you have a catch on every chain.
        this.log( err );
      } );

    this.connected = true;

    this.notify();
  }

  notify( data ) {
    this.emit( 'update', data );
  }

  safeSend( key, data = null ) {
    console.log( `OBSSEND: ${key} ${JSON.stringify( data, null, 2 )}` );
    if ( data != null )
      return this.obs.send( key, data ).catch( ( err ) => {
        return err;
      } )
    else
      return this.obs.send( key ).catch( ( err ) => {
        return err;
      } )
  }

  // obj can contain multiple commands
  // JavaScript preserves the ordering of the keys
  async multiSend( obj ) {
    console.log( `OBSMULTISEND: ${JSON.stringify( obj, null, 2 )}` );
    if ( !this.connected ) return;

    let retval = [];
    for ( let key of Object.keys( obj ) ) {
      // it's a promise so we can wait for the results
      retval.push(
        await this.obs.send( key, obj[ key ] )
          .catch( ( err ) => {
            return err;
          }
          ) );
    }
    return retval;
  }

  renameSource( data ) {
    this.sources[ data.newName ] = this.sources[ data.previousName ];
    delete data.previousName;
    this.notify();
  }

  // don't trust the sources from the scene objects until we rewrite the code
  // to link the scene sources to the actual sources object.
  updateScenes( arr_scenes ) {
    this.scenes = {};
    arr_scenes.forEach( ( e ) => ( this.scenes[ e.name ] = e ) );
    this.notify();
  }

  updateSources( arr_sources ) {
    this.sources = {};
    arr_sources.forEach( ( e ) => ( this.sources[ e.name ] = e ) );
    this.notify();
  }

  // GLOBAL GETTERS
  async getOBSStatus() {
    console.log( 'requesting status details from OBS' );
    // some of the api requires studio mode
    let [ studio, sources, scenes, preview, trans ] = await this.multiSend( {
      GetStudioModeStatus: {},
      GetSourcesList: {},
      GetSceneList: {},
      GetPreviewScene: {},
      GetCurrentTransition: {},
    } ).catch( e => console.log( e ) );
    this.studioMode = studio.studioMode;
    this.currentSceneName = scenes.currentScene;
    this.previewSceneName = preview.name;
    this.defaultTransition = trans.name;
    this.defaultTransitionDuration = trans.duration ?? 0;
    // console.log( [ studio, sources, scenes, preview ] );
    this.updateScenes( scenes.scenes );
    this.updateSources( sources.sources );
  }

  // GLOBAL SETTERS
  setStudioMode( onoff = true ) {
    return onoff
      ? this.safeSend( 'EnableStudioMode' )
      : this.safeSend( 'DisableStudioMode' );
  }

  // SCENE SETTERS
  setPreviewScene( scene ) {
    return this.safeSend( 'SetPreviewScene', { 'scene-name': scene } );
  }

  setCurrentScene( scene ) {
    return this.safeSend( 'SetCurrentScene', { 'scene-name': scene } );
  }

  transitionToScene( transition = null, scene = null, duration = null ) {
    // remember, Javascript will preserve the insertion order of these keys
    let cmd = {};
    if ( transition != null )
      cmd.SetCurrentTransition = { 'transition-name': transition };

    if ( duration != null ) cmd.SetTransitionDuration = { duration };

    if ( scene == null ) {
      cmd.TransitionToProgram = {};
    } else {
      cmd.SetCurrentScene = { 'scene-name': scene };
    }
    return this.multiSend( cmd );
  }

  // when input is null, we toggle between program and preview
  fadeToScene( scene = null, duration = null ) {
    return this.transitionToScene( 'Fade', scene, duration );
  }

  cutToScene( scene = null ) {
    return this.transitionToScene( 'Cut', scene );
  }

  transition( transition_type = null ) {
    return this.transitionToScene( transition_type );
  }

  fade( duration = null ) {
    return this.fadeToScene( null, duration );
  }

  cut() {
    return this.cutToScene( null );
  }

  // SOURCE SETTERS
  setSourceMute( source, onoff = null ) {
    if ( onoff == null )
      return this.safeSend( 'ToggleMute', { source } );
    return this.safeSend( 'SetMute', { source, mute: onoff } );
  }

  setSourceText( source = null, text = '' ) {
    // DEPRECATED FUNCTION
    // SetTextFreetype2Properties
    // input type: text_ft2_source_v2

    // CURRENT FUNCTION
    // SetTextGDIPlusProperties
    // input type

    // since OBS uses two different text inputs
    // we send to both... it's wasteful, but not a problem

    // also, OBS won't actually update the text source if text is empty
    text = text == '' ? ' ' : text;
    source = source ?? this.default_title_source;
    return this.multiSend( {
      SetTextFreetype2Properties: { source, text },
      SetTextGDIPlusProperties: { source, text },
    } );
  }

  setStreaming( onoff = null ) {
    if ( onoff == null ) return this.safeSend( 'StartStopStreaming' );
    if ( onoff ) return this.safeSend( 'StartStreaming' );
    return this.safeSend( 'StopStreaming' );
  }

  setRecording( onoff = null ) {
    if ( onoff == null ) return this.safeSend( 'StartStopRecording' );
    if ( onoff ) return this.safeSend( 'StartRecording' );
    return this.safeSend( 'StopRecording' );
  }

  setOutput( output, onoff ) {
    if ( onoff == true ) return this.safeSend( 'StartOutput', { outputName: output } );
    else return this.safeSend( 'StopOutput', { outputName: output } );
  }

  async setSceneItemRender( sourcename, onoff, scenename = null ) {
    await this.getOBSStatus();
    let prog = this.currentSceneName;
    let prev = this.previewSceneName;
    let r = [];
    let args = {
      source: sourcename,
      render: onoff,
    }
    if ( scenename != null ) args[ 'scene-name' ] = scenename;
    r.push( await this.safeSend( 'SetSceneItemRender', args ) );

    if ( this.studioMode ) {
      if ( scenename == prog ) {
        r.push( await this.setCurrentScene( prog ) );
        setTimeout( () => this.setPreviewScene( prev ), this.defaultTransitionDuration + 100 );
      }
    }
    return r;
  }
}


// class OBSCommand {
//   constructor ( { command, options } ) {
//     this.command = command;
//     this.options = options;
//   }
// }

module.exports.OBSController = OBSController;
