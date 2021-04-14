const got = require( 'got' );
const { Module, ModuleTrigger, ModuleTriggerArg } = require( './module' );

// NOTE: OBS WebSocket Documentation is here:
// https://www.npmjs.com/package/obs-websocket-js
// https://github.com/Palakis/obs-websocket

class HTTPController extends Module {
  static name = 'http';
  static niceName = 'HTTP Controller';
  static create( config ) {
    return new HTTPController( config );
  }

  constructor ( config ) {
    super( config );

    // setup triggers
    this.registerTrigger(
      new ModuleTrigger(
        'http',
        `Will issue an arbitrary http request based on this slide note tag.`,
        [
          new ModuleTriggerArg(
            'url',
            'string',
            'url can be https or http, query params should be urlencoded',
            false,
          ),
          new ModuleTriggerArg(
            'data', 'json', 'If data is empty, the method will be GET, otherwise the method will be POST. Data will be POSTed using content-type: application/json', true,
          ),
          new ModuleTriggerArg(
            'bearer', 'string', 'If this request needs authorization, put the bearer token here.', true,
          ),
        ],
        async ( _, url, data = null, bearer = null ) => {
          let options = {};
          let body;
          if ( bearer != null ) options.headers = { Authorization: `Bearer ${bearer}` }
          try {
            if ( data == null || data == '' || data == {} ) {
              let r = await got( url, options );
              body = r.body;
            } else {
              let r = await got.post( url, {
                ...options,
                json: data,
                responseType: 'json',
              } );
              body = r.body;
            }
            this.emit( 'body', body );
          } catch ( e ) {
            this.emit( 'error', e );
          }
        }
      )
    );
  }

}

module.exports.HTTPController = HTTPController;
