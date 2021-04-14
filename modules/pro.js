// WS module doesn't work in browsers
const { EventEmitter } = require( 'ws' );
const WebSocket = require( 'ws' );

const { Module, ModuleTrigger, ModuleTriggerArg } = require( './module.js' );
const { hms2secs, timestring2secs, markdown } = require( '../helpers.js' );

class ProController extends Module {
  static name = 'pro';
  static niceName = 'ProPresenter Controller';
  static supportsMultiple = true;
  static instances = [];
  static get master() {
    for ( let i of ProController.instances ) {
      if ( i.master ) return i;
    }
    // looks like there is no master instance... create it now
    return new ProController( {} );
  }

  static create( config ) {
    return new ProController( config );
  }

  get slides() {
    return this.sd.slides;
  }

  get connected() {
    return this.sd.connected && this.remote.connected;
  }

  constructor ( config, reset = false ) {
    super( config );

    if ( reset ) {
      for ( let i of ProController.instances ) {
        i.dispose();
      }
      ProController.instances.length = 0;
    }

    // store in the static instances list
    this.id = ProController.instances.length;
    ProController.instances.push( this );

    // setup object properties
    this.master = this.id == 0; // the first instance is by default the master instance
    this.follower = false;
    // this.options = options;

    this.updateConfig( config );

  }

  updateConfig( config ) {
    let { host, port, sd_pass, version = 6, remote_pass } = config;
    this.host = host;
    this.port = port;
    this.version = version;
    this.sd_pass = sd_pass;
    this.remote_pass = remote_pass;

    // setup connections
    if ( this.sd ) this.sd.removeAllListeners();
    this.sd = new ProSDClient( host, port, sd_pass, version, this );

    if ( this.remote ) this.remote.removeAllListeners();
    this.remote = new ProRemoteClient( host, port, remote_pass, version, this );

    // exposes the names of the events available on this emitter
    this.events = [
      'sdupdate',
      'sddata',
      'msgupdate',
      'sysupdate',
      'slideupdate',
      'timersupdate',
      'remoteupdate',
      'remotedata',
    ];

    this.sd.on( 'update', () => this.emit( 'sdupdate', this.fullStatus() ) );
    this.sd.on( 'data', ( data ) => this.emit( 'sddata', data ) );
    this.sd.on( 'msgupdate', ( data ) => this.emit( 'msgupdate', data ) );
    this.sd.on( 'sysupdate', ( data ) => this.emit( 'sysupdate', data ) );
    this.sd.on( 'slideupdate', ( data ) => this.emit( 'slideupdate', data ) );
    this.sd.on( 'timersupdate', ( data ) => this.emit( 'timersupdate', data ) );

    this.remote.on( 'update', () => this.emit( 'remoteupdate', this.fullStatus() ) );
    this.remote.on( 'data', ( data ) => {
      this.emit( 'remotedata', data );
      if ( this.master ) {
        for ( let i of ProController.instances ) {
          if ( i.id == this.id ) continue;
          if ( i.follower ) i.remote.send( data );
        }
      }
    } );

    this._registerDefaultTriggers();
  }

  getInfo() {
    return {
      ...super.getInfo(),
      ...this.status(),
    };
  }

  status() {
    let r = {
      master: this.master,
      connected: this.connected,
      controlling: this.remote.controlling,
      ...this.sd.status(),
    };
    // r.master = this.master;
    // r.follower = this.follower;
    // r.slides = this.slides;
    // r.sd = this.sd.status();
    return r;
  }

  fullStatus() {
    return {
      ...this.status(),
      ...this.remote.status,
    };
  }

  _registerDefaultTriggers() {
    this.triggers = [];

    // // register default triggers
    // this.registerTrigger(
    //   new ModuleTrigger(
    //     'master',
    //     'flags the source propresenter instance as the master instance',
    //     [],
    //     (caller) => {
    //       caller.master = true;
    //       caller.follower = false;
    //       caller.emit('update');
    //     }
    //   )
    // );

    // this.registerTrigger(
    //   new ModuleTrigger(
    //     'follow',
    //     'flags the source propresenter instance as a follower instance',
    //     [
    //       new ModuleTriggerArg(
    //         'onoff',
    //         'bool',
    //         'turn following on or off for this instance',
    //       )
    //     ],
    //     (caller, onoff) => {
    //       caller.follower = onoff == true;
    //       caller.emit('update');
    //     }
    //   )
    // );
  }
}

class ProSlide {
  constructor ( uid = '', text = '', notes = '' ) {
    this.uid = uid;
    this.text = text;
    this.notes = notes;
  }
}

// listens to ProPresenter as a stage display client
class ProSDClient extends EventEmitter {
  constructor ( host, port, password, version = 6, parent ) {
    super();
    this.host = host;
    this.port = port;
    this.password = password;
    this.version = version;
    this.parent = parent;

    // internal state
    this.connected = false;
    this.active = false;

    // tracking propresenter state
    this.stage_message = '';
    this.system_time = { text: '', seconds: 0 };
    this.timers = {};
    this.slides = {
      current: new ProSlide(),
      next: new ProSlide(),
    };

    this.ondata = ( data ) => this.emit( 'data', data, this );
    this.onmsgupdate = ( data ) => this.emit( 'msgupdate', data, this );
    this.onsysupdate = ( data ) => this.emit( 'sysupdate', data, this );
    this.onslideupdate = ( data ) => this.emit( 'slideupdate', data, this );
    this.ontimersupdate = ( data ) => this.emit( 'timersupdate', data, this );

    this.connect();
  }

  notify() {
    this.emit( 'update', this );
  }

  status() {
    return {
      system_time: this.system_time,
      timers: this.timers,
      stage_message: this.stage_message,
      slides: this.slides,
      connected: this.connected,
      active: this.active,
    };
  }


  close() {
    this.ws?.terminate();
    this.connected = false;
    this.active = false;
    this.notify();
  }


  reconnect( delay = 0 ) {
    this.parent.log( `Attempting reconnect in ${delay} seconds.` );
    clearTimeout( this.reconnectTimeout );
    this.reconnectTimeout = setTimeout( () => {
      this.connect();
    }, delay * 1000 );
  }

  connect() {
    this.connected = false;
    this.active = false;

    clearTimeout( this.reconnectTimeout );

    let url = `ws://${this.host}:${this.port}/stagedisplay`;
    console.log( `ProSDClient: connecting to ${url}` );
    if ( this.ws ) this.close();
    try {
      this.ws = new WebSocket( url );
    } catch ( e ) {
      this.close();
      console.log( 'ERROR: Could not connect to ' + url );
      console.log( e );
      return;
    }

    this.ws.on( 'error', ( err ) => {
      this.parent.log( 'ProPresenter WebSocket Error:' );
      // this.parent.log(err);
      this.ws.terminate();
      this.reconnect( 30 );
      this.notify();
    } );

    this.ws.on( 'message', ( data ) => {
      this.check( JSON.parse( data ) );
      this.notify();
    } );

    this.ws.on( 'open', () => {
      this.connected = true;
      this.authenticate();
      this.notify();
    } );

    this.ws.on( 'close', () => {
      // this.ws.terminate();
      this.reconnect( 10 );
      this.connected = false;
      this.active = false;
      this.notify();
    } );
  }

  send( Obj ) {
    this.ws.send( JSON.stringify( Obj ) );
  }

  authenticate() {
    let auth = {
      pwd: this.password,
      ptl: this.version * 100 + 10,
      acn: 'ath',
    };
    this.send( auth );
  }

  check( data ) {
    this.parent.log( data );
    let newdata = {};
    switch ( data.acn ) {
      case 'ath':
        //{"acn":"ath","ath":true/false,"err":""}
        if ( data.ath ) {
          this.parent.log( 'ProPresenter Listener is Connected' );
          this.active = true;
          newdata = { type: 'authentication', data: true };
        } else {
          this.connected = false;
          this.active = false;
          newdata = { type: 'authentication', data: false };
        }
        break;
      case 'tmr':
        this.timers[ data.uid ] = {
          uid: data.uid,
          text: data.txt,
          seconds: hms2secs( data.txt ),
        };
        newdata = { type: 'timer', data: this.timers[ data.uid ] };
        if ( this.ontimersupdate ) this.ontimersupdate( this.timers[ data.uid ] );
        break;
      case 'sys':
        // { "acn": "sys", "txt": " 11:17 AM" }
        this.system_time = {
          text: data.txt,
          seconds: timestring2secs( data.txt ),
        };
        newdata = { type: 'systime', data: this.system_time };
        if ( this.onsysupdate ) this.onsysupdate( this.system_time );
        break;
      case 'msg':
        // { acn: 'msg', txt: 'Test' }
        this.stage_message = data.txt;
        newdata = { type: 'message', data: this.stage_message };
        if ( this.onmsgupdate ) this.onmsgupdate( this.stage_message );
        break;
      case 'fv':
        // we just got stage display slide information
        this.slides.current = new ProSlide();
        this.slides.next = new ProSlide();

        // the 'ary' object contains a list (unordered) of 4 items
        // where each item will be identified by the 'acn' field as
        // cs: current slide
        // csn: current slide notes
        // ns: next slide
        // nsn: next slide notes
        for ( let blob of data.ary ) {
          switch ( blob.acn ) {
            case 'cs':
              this.slides.current.uid = blob.uid;
              this.slides.current.text = blob.txt;
              break;
            case 'csn':
              this.slides.current.notes = blob.txt;
              break;
            case 'ns':
              this.slides.next.uid = blob.uid;
              this.slides.next.text = blob.txt;
              break;
            case 'nsn':
              this.slides.next.notes = blob.txt;
              break;
          }
        }
        newdata = { type: 'slides', data: this.slides };
        if ( this.onslideupdate ) this.onslideupdate( this.slides );
    }
    if ( this.ondata ) this.ondata( newdata, this );
  }
}

// incomplete at the moment
class ProRemoteClient extends EventEmitter {
  constructor ( host, port, password, version = 6, parent ) {
    super();
    this.connected = false;
    this.controlling = false;
    this.host = host;
    this.port = port;
    this.password = password;
    this.version = version;
    this.parent = parent;

    this.callbacks = {};

    // handle pro6 status
    this.status = {
      currentPresentation: null,
      currentSlideIndex: 0,
      library: [],
      playlists: [],
    };

    this.connect();
  }

  close() {
    this.ws?.terminate();
    this.connected = false;
    this.controlling = false;
    this.notify();
  }

  connect() {
    let url = `ws://${this.host}:${this.port}/remote`;
    console.log( `ProRemote: connecting to ${url}` );
    if ( this.ws ) this.close();
    try {
      this.ws = new WebSocket( url );
    } catch ( e ) {
      this.close();
      console.log( 'ERROR: Could not connect to ' + url );
      console.log( e );
      return;
    }

    this.ws.on( 'message', ( data ) => {
      this.handleData( JSON.parse( data ) );
      this.notify();
    } );
    this.ws.on( 'open', () => {
      this.authenticate();
      this.notify();
    } );
    this.ws.on( 'close', () => {
      this.connected = false;
      this.controlling = false;
      this.notify();
    } );
    this.ws.on( 'error', () => {
      this.connected = false;
      this.controlling = false;
      this.notify();
    } );
  }

  // notify is used for any status updates
  notify() {
    this.emit( 'update', this );
  }

  send( Obj, callback = null ) {
    // register callback if there is one.
    if ( typeof callback == 'function' ) {
      // fix api bug
      let responseAction = Obj.action;
      if ( Obj.action == 'presentationRequest' )
        responseAction = 'presentationCurrent';
      this.callbacks[ responseAction ] = callback;
    }
    this.ws.send( JSON.stringify( Obj ) );
  }

  authenticate() {
    let auth = {
      password: this.password,
      protocol: this.version * 100,
      action: 'authenticate',
    };
    this.send( auth );
  }

  flattenPlaylist( playlistObj ) {
    let flattened = [];
    switch ( playlistObj.playlistType ) {
      case 'playlistTypePlaylist':
        flattened = playlistObj.playlist;
        break;
      case 'playlistTypeGroup':
        for ( let playlist of playlistObj.playlist ) {
          flattened.push( ...this.flattenPlaylist( playlist ) );
        }
        break;
    }
    return flattened;
  }

  loadStatus() {
    this.getLibrary();
    this.getPlaylists();
    this.getPresentation();
    this.getCurrentSlideIndex();
  }

  handleData( data ) {
    this.parent.log( data );

    // process data for this class instance
    switch ( data.action ) {
      case 'authenticate':
        if ( data.authenticated == 1 ) this.connected = true;
        if ( data.controller == 1 ) this.controlling = true;

        if ( this.connected ) this.loadStatus();
        break;
      case 'libraryRequest':
        this.status.library = data.library;
        break;
      case 'playlistRequestAll':
        this.status.playlists = this.flattenPlaylist( data.playlistAll );
        break;
      case 'presentationCurrent':
        this.status.currentPresentation = data.presentation;
        break;
      case 'presentationSlideIndex':
        this.status.currentSlideIndex = +data.slideIndex;
        break;
      case 'presentationTriggerIndex':
        this.status.currentSlideIndex = +data.slideIndex;
        if ( this.status.currentPresentation != data.presentationPath ) {
          this.getPresentation( data.presentationPath );
        }
    }

    // handle update stream
    this.emit( 'data', data, this );

    // handle callbacks
    if ( typeof this.callbacks[ data.action ] == 'function' ) {
      this.callbacks[ data.action ]( data );
      delete this.callbacks[ data.action ];
    }
  }

  getLibrary( callback = null ) {
    this.send( { action: 'libraryRequest' }, callback );
  }

  getPlaylists( callback = null ) {
    this.send( { action: 'playlistRequestAll' }, callback );
  }

  getPresentation( path = null, quality = 200, callback = null ) {
    if ( path == null ) {
      this.send(
        {
          action: 'presentationCurrent',
          presentationSlideQuality: quality,
        },
        callback
      );
    } else {
      this.send(
        {
          action: 'presentationRequest',
          presentationPath: path,
          presentationSlideQuality: quality,
        },
        callback
      );
    }
  }

  getCurrentSlideIndex( callback = null ) {
    this.send( { action: 'presentationSlideIndex' }, callback );
  }

  triggerSlide( index = 0, path = null, callback = null ) {
    if ( !this.controlling ) return false;
    if ( path == null && this.status.currentPresentation == null ) return false;
    if ( path == null )
      path = this.status.currentPresentation.presentationCurrentLocation;
    this.send(
      {
        action: 'presentationTriggerIndex',
        slideIndex: index,
        presentationPath: path,
      },
      callback
    );
    return true;
  }

  next( callback = null ) {
    if ( this.status.currentPresentation == null ) return false;
    if ( this.status.currentSlideIndex == null ) return false;
    let nextIndex = this.status.currentSlideIndex + 1;
    return this.triggerSlide( nextIndex, null, callback );
  }

  prev( callback = null ) {
    if ( this.status.currentPresentation == null ) return false;
    if ( this.status.currentSlideIndex == null ) return false;
    let nextIndex = this.status.currentSlideIndex - 1;
    if ( nextIndex < 0 ) nextIndex = 0;
    return this.triggerSlide( nextIndex, null, callback );
  }
}

module.exports.ProController = ProController;
