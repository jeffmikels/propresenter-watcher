const got = require( 'got' );

class WebLogger {
  constructor ( url, key ) {
    this.key = key;
    this.url = url;
    this.debugLocal = false;
  }

  /// will run asynchronously
  log( s, forceLocal = false ) {
    if ( this.debugLocal || forceLocal )
      console.log( `sending to external log: "${s}"` );
    got
      .post( this.url, {
        body: JSON.stringify( {
          key: this.key,
          logstring: s,
        } ),
      } )
      .then( ( res, err ) => {
        if ( err ) {
          console.log( 'error with remote log...' );
          console.log( err );
        }
      } );
  }
}

module.exports = WebLogger;
