var http = require('http'),
    querystring = require('querystring');

function httpRequest(method, path, payload) {
  var query = {u: 'root', p: 'root'};

  var req = http.request({
    hostname: 'localhost',
    port: 8086,
    path: path + '?' + querystring.stringify(query),
    method: method.toUpperCase(),
    agent: false
  });

  req.on('response', function (res) {
    res.on('data', function (chunk) {
      console.log('RESPONSE: ' + chunk.toString());
    });
  });

  req.on('error', function (e) {
    console.log(e);
  });

  if (payload) {
    req.write(JSON.stringify(payload));
  }
  req.end();
}

switch (process.argv[2]) {
  case 'createdb': {
    console.log('Creating database: "statsd"');
    httpRequest('post', '/db', {name: "statsd"});
    break;
  }
  case 'dropdb': {
    console.log('Deleting database: "statsd"');
    httpRequest('delete', '/db/statsd');
    break;
  }
  case 'createuser': {
    console.log('Creating user "user" with password "pass"');
    httpRequest('post', '/db/statsd/users', {username: 'user', password: 'pass'});
    break;
  }
  case 'createadmin': {
    console.log('Creating user "admin" with password "pass"');
    httpRequest('post', '/db/statsd/users', {username: 'admin', password: 'pass', admin: true});
    break;
  }
  default: {
    console.log('Commands: createdb, dropdb, createuser');
  }
}
