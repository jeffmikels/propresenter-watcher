// helper functions
function hms2secs( hms ) {
	var a = hms.split( ":" ); // split it at the colons
	// the '+' prefix coerces the string to a number
	var seconds = +a[ 0 ] * 60 * 60 + +a[ 1 ] * 60 + +a[ 2 ];
	if ( isNaN( seconds ) ) seconds = 0;
	return seconds;
}
function timestring2secs( timestring ) {
	var match = timestring.match( /\s*(\d+:\d+)\s*([AP]M)/ );
	if ( !match ) return 0;
	let a = match[ 1 ].split( ":" );
	// the '+' prefix coerces the string to a number
	var seconds = +a[ 0 ] * 60 * 60 + +a[ 1 ] * 60;
	if ( isNaN( seconds ) ) seconds = 0;
	if ( match[ 2 ] == "PM" ) seconds += 12 * 60 * 60;
	return seconds;
}

function markdown( s = '' ) {
	s = s.replace( /_(.*?)_/g, `<span class="blank">$1</span>` );
	return s;
}

module.exports = { hms2secs, timestring2secs, markdown }
