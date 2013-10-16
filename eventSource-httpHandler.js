var
	KEEP_ALIVE,
	WAIT_DELAY,
	RETRY_DELAY,
	EOL,
	COMMENT,
	sse;

sse = require('wakanda-eventsource');

KEEP_ALIVE = 115; // in seconds - default in Firefox
WAIT_DELAY = 100 * 1000; // delay in ms before forced reconnection
RETRY_DELAY = 1; // EventSource retry delay in seconds
EOL = '\n';
COMMENT = ': ';

function push(connection, message, nowait) {
    // We send the chunk that needs to be send now
    connection.sendChunkedData(message);

	// For now, we need to release the wait for the response to be sent
    exitWait();

    if (!nowait) {
		// We wait again for the next datas
        wait();
	}
}


function pushComment(connection, comment, nowait) {
	push(connection, COMMENT + comment + EOL, nowait);
}


function oneventsourceconnect(httpRequest, httpResponse) {
	var
		connection,
		headers,
		accept,
		lastEventId,
		worker,
		workerPort,
		eventsFilter,
		noComment;

	
	if (httpRequest.urlQuery === 'runTests') {
	    // test suite
	    return require('wakanda-eventsource/tests/httpHandler').oneventsourceconnect(httpRequest, httpResponse);
	}

	connection = httpResponse;
	headers = connection.headers;
	accept = httpRequest.headers.Accept;

	if (accept.indexOf('application/json') > -1) {
		headers['Content-Type'] = 'application/json';
		return JSON.stringify({
		    started: true, 
		    runTest: false
		});
	}

	if (accept.indexOf('text/event-stream') === -1) {
		headers['Content-Type'] = 'text/plain';
		return 'This event source service is active but requires the client to accept "text/event-stream" content type to work';
	}



	// Specify that we'll send server events
	headers['Content-Type'] = 'text/event-stream';
	headers.Connection = 'keep-alive';
	headers['Keep-Alive'] = String(KEEP_ALIVE);
	headers['Cache-Control'] = 'no-cache';

	eventsFilter = httpRequest.urlPath.split('/')[2];
	eventsFilter = eventsFilter && eventsFilter.split(',');
	noComment = (httpRequest.urlQuery.split('&').indexOf('noComment') !== -1);

	lastEventId = httpRequest.headers['Last-Event-Id'];
	if (lastEventId !== undefined) {
		lastEventId = Number(lastEventId);
	}

	worker = new SharedWorker(sse.WORKER_PATH, sse.WORKER_ID);
	workerPort = worker.port;

	workerPort.onmessage = function onmessage(event) {
		var
			data;

		data = event.data;
        switch (data.type) {

        case sse.PUSH:
	        push(connection, data.message);
            break;

		case sse.CONNECTION_READY:
            // Send a comment - not mandatory - just to make it clear
	        pushComment(connection, 'connection ready');
			break;

		case sse.STOP:
			// we can end the HTTP connection
	        pushComment(connection, 'event source stop', true);
			break;

		default:
			console.warning('unexpected worker message', data);
        }
	};

	sessionStorage['wakanda-eventsource'] = true;

	// We register to tell to the SharedWorker to send us the message when it's fired
	workerPort.postMessage({
		type: 'register',
		lastEventId: lastEventId,
		session: currentSession().ID,
		user: currentUser().ID,
		eventsFilter: eventsFilter,
		noComment: noComment
	});

	// Wait to keep the context alive
	wait(WAIT_DELAY);

    connection.sendChunkedData('retry: ' + RETRY_DELAY);

    // if wait() is bypassed, there should be a disconnection
	workerPort.postMessage({
		type: 'disconnect',
		delay: RETRY_DELAY * 3,
		session: currentSession().ID,
		user: currentUser().ID
	});
	
	if (typeof workerPort.close === 'function') {
		workerPort.close();
	}

	workerPort = null;
	worker = null;

}

exports.oneventsourceconnect = oneventsourceconnect;