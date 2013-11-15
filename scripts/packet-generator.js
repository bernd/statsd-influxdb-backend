var dgram = require('dgram'),
    socket = dgram.createSocket('udp4');

var sendMetric = (function (socket) {
  var f = function (msg) {
    var message = new Buffer(msg);

    socket.send(message, 0, message.length, 8125, '127.0.0.1', function (e) {
      if (e) { console.log(e); }
    });
  }

  return f;
})(socket);

var cnt = 0;

function sendLoop() {
  var random1 = parseInt(Math.random() * 1000),
      random2 = parseInt(Math.random() * 1000);

  if ((cnt++ % 100) == 0) {
    console.log('count ' + cnt);
  }

  sendMetric('api.requests:1|c');
  sendMetric('api.response_times:' + random1 + '|ms');
  sendMetric('api.bytes:' + random2 + '|g');
}

setInterval(sendLoop, 1);
