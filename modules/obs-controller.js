const OBSWebSocket = require("obs-websocket-js");
const { Module, ModuleTrigger, ModuleTriggerArg } = require("./module");

// NOTE: OBS WebSocket Documentation is here:
// https://www.npmjs.com/package/obs-websocket-js
// https://github.com/Palakis/obs-websocket

class OBSController extends Module {
  static name = "obs";
  static niceName = "OBS Controller";
  static create(config) {
    return new OBSController(config);
  }

  constructor(config) {
    super(config);
    let { host, port, password } = config;

    this.host = host;
    this.port = port;
    this.password = password;
    this.default_title_source = config.default_title_source ?? "Lyrics";
    this.obs = new OBSWebSocket();
    this.studioMode = false;

    // remember sources and scenes so we don't
    // need to make requests all the time
    // (keyed by source name)
    this.sources = {};
    this.scenes = {};
    this.currentSceneName = "";
    this.previewSceneName = "";

    // triggers and functions needed
    /*

		TODO: Allow the use of numbers to refer to scenes and scene items
		TODO: use catch on all this.obs.send commands !!!

		TRIGGERS:
			obs['jsonstring'] -> this.api
			obsstream[onoff] -> this.setStream(onoff)
			obsrecord[onoff] -> this.setRecord(onoff)
			obsoutput[output?,onoff] -> this setOutput(output)
			obstext[sourcename,text] -> this setSourceText()
			obspreview[scene] -> this.setPreview()
			obscut[scene?] -> this.cutToScene()
			obsfade[scene?,duration?] -> this.fadeToScene()
			obstransition[scene?,transition?,duration?] -> this.transitionToScene();
			obsmute[source,onoff] -> this.setSourceMute()

			// using SetSceneItemRender
			obsactivate[sourcename, onoff, scenename?] -> this.setSourceActive
			
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
        "~slideupdate~",
        `Will update a text source identified by default_title_source in the configuration on every slide update unless the slide notes contain "noobs"`,
        [],
        (pro) => {
          if (pro.slides.current.notes.match(/noobs/)) return;
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
        "obs",
        "sends commands directly to the obs api ",
        [
          new ModuleTriggerArg(
            "json_string",
            "json",
            '{"SetCurrentScene": {"scene-name": "Live Broadcast"}}',
            false
          ),
        ],
        (_, data = null) => (data == null ? null : this.api(data))
      )
    );

    this.connect();
  }

  getInfo() {
    let r = super.getInfo();
    r.sources = this.sources;
    r.scenes = this.scenes;
    r.currentSceneName = this.currentSceneName;
    return r;
  }

  async connect() {
    this.connected = false;
    let address = `${this.host}:${this.port}`;
    let password = this.password;
    this.obs
      .connect({ address, password })
      .then(() => {
        this.connected = true;

        this.on("SwitchScenes", (d) => (this.currentSceneName = d.sceneName));
        this.on("ScenesChanged", (arr) => this.updateScenes(arr));
        this.on("SourceRenamed", (d) => this.renameSource(d));

        // not implemented, but might be useful
        // this.on( 'SourceCreated', ( d ) => this.handleSourceCreated(d) );
        // this.on( 'SourceDestroyed', ( d ) => this.handleSourceDestroyed(d) );

        this.getStatus();
      })
      .catch((err) => {
        // Promise convention dicates you have a catch on every chain.
        this.log(err);
      });

    this.connected = true;

    this.notify();
  }

  notify(data) {
    this.emit("update", data);
  }

  // obj can contain multiple commands
  // JavaScript preserves the ordering of the keys
  async api(obj) {
    if (!this.connected) return;

    let retval = [];
    for (let key of Object.keys(obj)) {
      // it's a promise so we can wait for the results
      retval.push(
        await this.obs.send(key, obj[key]).catch((err) => {
          return err;
        })
      );
    }
    return retval;
  }

  renameSource(data) {
    this.sources[data.newName] = this.sources[data.previousName];
    delete data.previousName;
    this.notify();
  }

  // don't trust the sources from the scene objects until we rewrite the code
  // to link the scene sources to the actual sources object.
  updateScenes(arr_scenes) {
    this.scenes = {};
    arr_scenes.forEach((e) => (this.scenes[e.name] = e));
    this.notify();
  }

  updateSources(arr_sources) {
    this.sources = {};
    arr_sources.forEach((e) => (this.sources[e.name] = e));
    this.notify();
  }

  // GLOBAL GETTERS
  async getStatus() {
    // some of the api requires studio mode
    this.setStudioMode(true);
    let [sources, scenes, preview] = await this.api({
      GetSourcesList: {},
      GetSceneList: {},
      GetPreviewScene: {},
    });
    this.updateScenes(scenes.scenes);
    this.updateSources(sources.sources);
    this.currentSceneName = scenes.currentScene;
    this.previewSceneName = preview.sceneName;
    this.notify();
  }

  // GLOBAL SETTERS
  async setStudioMode(onoff = true) {
    return onoff
      ? await this.obs.send("EnableStudioMode")
      : await this.obs.send("DisableStudioMode");
  }

  // SCENE SETTERS
  async setPreviewScene(scene) {
    return await this.obs.send("SetPreviewScene", { "scene-name": scene });
  }

  async transitionToScene(transition = null, scene = null, duration = null) {
    // remember, Javascript will preserve the insertion order of these keys
    let cmd = {};
    if (transition != null)
      cmd.SetCurrentTransition = { "transition-name": transition };

    if (duration != null) cmd.SetTransitionDuration = { duration };

    if (scene == null) {
      cmd.TransitionToProgram = {};
    } else {
      cmd.SetCurrentScene = { "scene-name": scene };
    }
    return await this.api(cmd);
  }

  // when input is null, we toggle between program and preview
  async fadeToScene(scene = null, duration = null) {
    return await this.transitionToScene("Fade", scene, duration);
  }

  async cutToScene(scene = null) {
    return await this.transitionToScene("Cut", scene);
  }

  async transition(transition_type = null) {
    return await this.transitionToScene(transition_type);
  }

  async fade(duration = null) {
    return await this.fadeToScene(null, duration);
  }

  async cut() {
    return await this.cutToScene(null);
  }

  // SOURCE SETTERS
  async setSourceMute(source, onoff = true) {
    return await this.obs.send("SetMute", { source, mute: onoff });
  }

  async setSourceText(source = null, text = "") {
    // DEPRECATED FUNCTION
    // SetTextFreetype2Properties
    // input type: text_ft2_source_v2

    // CURRENT FUNCTION
    // SetTextGDIPlusProperties
    // input type

    // since OBS uses two different text inputs
    // we send to both... it's wasteful, but not a problem

    // also, OBS won't actually update the text source if text is empty
    text = text == "" ? " " : text;
    source = source ?? this.default_title_source;
    return await this.api({
      SetTextFreetype2Properties: { source, text },
      SetTextGDIPlusProperties: { source, text },
    });
  }
}

class OBSCommand {
  constructor({ command, options }) {
    this.command = command;
    this.options = options;
  }
}

module.exports.OBSController = OBSController;
