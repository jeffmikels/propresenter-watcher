// helper functions
function hms2secs( hms ) {
  let sign = hms[ 0 ] == '-' ? -1 : 1;
  var [ h, m, s ] = hms.split( ':' ).map( e => parseInt( e ) ); // split it at the colons
  // the first number might be negative, so we
  // need to handle it specially;
  h = Math.abs( h );
  var seconds = sign * ( h * 60 * 60 + m * 60 + s );
  if ( isNaN( seconds ) ) seconds = 0;
  return seconds;
}
function timestring2secs( timestring ) {
  var match = timestring.match( /\s*(\d+:\d+)\s*([AP]M)/ );
  if ( !match ) return 0;
  let [ h, m ] = match[ 1 ].split( ':' ).map( e => parseInt( e ) );
  // the '+' prefix coerces the string to a number
  var seconds = h * 60 * 60 + m * 60;
  if ( isNaN( seconds ) ) seconds = 0;
  if ( match[ 2 ] == 'PM' ) seconds += 12 * 60 * 60;
  return seconds;
}

function markdown( s = '' ) {
  s = s.replace( /_(.*?)_/g, `<span class="blank">$1</span>` );
  return s;
}

module.exports = { hms2secs, timestring2secs, markdown };
