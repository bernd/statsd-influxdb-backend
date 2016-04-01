/*
 * Flush stats to InfluxDB (http://influxdb.org/)
 *
 * To enable this backend, include 'statsd-influxdb-backend' in the backends
 * configuration array:
 *
 *   backends: ['statsd-influxdb-backend']
 *
 * The backend will read the configuration options from the following
 * 'influxdb' hash defined in the main statsd config file:
 *
 * influxdb: {
 *   host: '127.0.0.1',   // InfluxDB host. (default 127.0.0.1)
 *   port: 8086,          // InfluxDB port. (default 8086)
 *   ssl: false,          // InfluxDB is hosted over SSL. (default false)
 *   database: 'dbname',  // InfluxDB database instance. (required)
 *   username: 'user',    // InfluxDB database username.
 *   password: 'pass',    // InfluxDB database password.
 *   flush: {
 *     enable: true       // Enable regular flush strategy. (default true)
 *   },
 *   proxy: {
 *     enable: false,       // Enable the proxy strategy. (default false)
 *     suffix: 'raw',       // Metric name suffix. (default 'raw')
 *     flushInterval: 1000  // Flush interval for the internal buffer.
 *                          // (default 1000)
 *   },
 *   includeStatsdMetrics: false, // Send internal statsd metrics to InfluxDB. (default false)
 *   includeInfluxdbMetrics: false // Send internal backend metrics to InfluxDB. (default false)
 *                                 // Requires includeStatsdMetrics to be enabled.
 * }
 *
 */
var util = require('util'),
    querystring = require('querystring'),
    http = require('http'),
    https = require('https');

function InfluxdbBackend(startupTime, config, events) {
  var self = this;

  self.debug = config.debug;
  self.registry = {};
  self.influxdbStats = {};

  self.defaultHost = '127.0.0.1';
  self.defaultPort = 8086;
  self.defaultVersion = 0.8;
  self.defaultFlushEnable = true;
  self.defaultProxyEnable = false;
  self.defaultProxySuffix = 'raw';
  self.defaultProxyFlushInterval = 1000;

  self.host = self.defaultHost;
  self.port = self.defaultPort;
  self.version = self.defaultVersion;
  self.protocol = http;
  self.flushEnable = self.defaultFlushEnable;
  self.proxyEnable = self.defaultProxyEnable;
  self.proxySuffix = self.defaultProxySuffix;
  self.proxyFlushInterval = self.defaultProxyFlushInterval;
  self.includeStatsdMetrics = false;
  self.includeInfluxdbMetrics = false;

  /* XXX Hardcoding default prefix here because it is not accessible otherwise. */
  self.prefixStats = config.prefixStats !== undefined ? config.prefixStats : 'statsd';

  if (config.influxdb) {
    self.host = config.influxdb.host || self.defaultHost;
    self.port = config.influxdb.port || self.defaultPort;
    self.version = config.influxdb.version || self.defaultVersion;
    self.user = config.influxdb.username;
    self.pass = config.influxdb.password;
    self.database = config.influxdb.database;
    self.includeStatsdMetrics = config.influxdb.includeStatsdMetrics;
    self.includeInfluxdbMetrics = config.influxdb.includeInfluxdbMetrics;

    if (config.influxdb.ssl) {
      self.protocol = https;
    }

    if (config.influxdb.flush) {
      self.flushEnable = config.influxdb.flush.enable;
    }

    if (config.influxdb.proxy) {
      self.proxyEnable = config.influxdb.proxy.enable || self.defaultProxyEnable;
      self.proxySuffix = config.influxdb.proxy.suffix || self.defaultProxySuffix;
      self.proxyFlushInterval = config.influxdb.proxy.flushInterval || self.defaultProxyFlushInterval;
    }
  }

  if (self.version >= 0.9) {
    self.assembleEvent = self.assembleEvent_v09;
    self.httpPOST = self.httpPOST_v09;
  } else {
    self.assembleEvent = self.assembleEvent_v08;
    self.httpPOST = self.httpPOST_v08;
  }

  if (self.proxyEnable) {
    events.on('packet', function (packet, rinfo, metrics) {
      try {
        self.processPacket(packet, rinfo, metrics);
      } catch (e) {
        self.log(e);
      }
    });
  } 

  if (self.flushEnable) {
    events.on('flush', function (timestamp, metrics) {
      try {
        self.processFlush(timestamp, metrics);
      } catch (e) {
        self.log(e);
      }
    });
  }
 
  events.on('status', function (writeCb) {
    for (var stat in self.influxdbStats) {
      writeCb(null, 'influxdb', stat, self.influxdbStats[stat]);
    }
  });

  return true;
}

function millisecondsSince(start) {
  diff = process.hrtime(start);
  return diff[0] * 1000 + diff[1] / 1000000;
}

function isNumber(str) {
    return Boolean(str && !isNaN(str));
}

InfluxdbBackend.prototype.log = function (msg) {
  util.log('[influxdb] ' + msg);
}

InfluxdbBackend.prototype.logDebug = function (msg) {
  if (this.debug) {
    var string;

    if (msg instanceof Function) {
      string = msg();
    } else {
      string = msg;
    }

    util.log('[influxdb] (DEBUG) ' + string);
  }
}

/**
 * Flush strategy handler
 *
 * @param {Number} timestamp
 * @param {Object} stats metric
 */
InfluxdbBackend.prototype.processFlush = function (timestamp, metrics) {
  var self = this,
      counters = metrics.counters,
      backfills = metrics.backfills,
      gauges = metrics.gauges,
      timerData = metrics.timer_data,
      statsdMetrics = metrics.statsd_metrics,
      points = [],
      sets  = function (vals) {
        var ret = {};
        for (var val in vals) {
          ret[val] = vals[val].values();
        }
        return ret;
      }(metrics.sets),
      startTime = process.hrtime(),
      key, timerKey,
      statsPrefixRegexp = new RegExp('^' + self.prefixStats + '\\.');


  for (key in counters) {
    /* Do not include statsd counters. */
    if (!self.includeStatsdMetrics && key.match(statsPrefixRegexp)) { continue; }

    var value = counters[key],
        k = self.addTypeToKey(key, 'counter');

    if (value) {
      points.push(self.assembleEvent(k, [{value: value, time: timestamp}]));
    }
  }

  for (key in backfills) {
    /* Do not include statsd counters. */
    if (!self.includeStatsdMetrics && key.match(statsPrefixRegexp)) { continue; }

    var value = backfills[key],
        k = key;

    if (value) {
      for (i=0;i<value.length;i++) {
        points.push(self.assembleEvent(k, [{value: value[i].value, timestamp: value[i].timestamp}]));
      }
    }
  }

  for (set in sets) {
    sets[set].map(function (v) {
      points.push(self.assembleEvent(set, [{value: v, time: timestamp}]));
    })
    points.push(self.assembleEvent(set + "_count", [{value: sets[set].length, time: timestamp}]));
  }

  for (key in gauges) {
    /* Do not include statsd gauges. */
    if (!self.includeStatsdMetrics && key.match(statsPrefixRegexp)) { continue; }

    var value = gauges[key],
        k = self.addTypeToKey(key, 'gauge');

    if (!isNaN(parseFloat(value)) && isFinite(value)) {
      points.push(self.assembleEvent(k, [{value: value, time: timestamp}]));
    }
  }

  for (key in timerData) {
    var timerMetrics = timerData[key];

    // Try to add histogram data, if it is there:
    if (timerMetrics.histogram) {
      var histoMetrics = timerMetrics.histogram
        , histoKey;

      for (histoKey in histoMetrics) {
        var value = histoMetrics[histoKey],
          k = self.addTypeToKey(key, 'timer.histogram.' + histoKey);

        points.push(self.assembleEvent(k, [{value: value, time: timestamp}]));
      }

      // Delete here so it isn't iterated over later:
      delete timerMetrics.histogram;
    }

    // Iterate over normal metrics:
    for (timerKey in timerMetrics) {
      var value = timerMetrics[timerKey],
          k = self.addTypeToKey(key, 'timer.'  + timerKey);

      points.push(self.assembleEvent(k, [{value: value, time: timestamp}]));
    }
  }

  if (self.includeStatsdMetrics) {
    // Include backend metrics for the previous flush
    if (self.includeInfluxdbMetrics) {
      statsdMetrics['influxdbStats.flush_time'] = self.influxdbStats.flushTime;
      statsdMetrics['influxdbStats.http_response_time'] = self.influxdbStats.httpResponseTime;
      statsdMetrics['influxdbStats.payload_size'] = self.influxdbStats.payloadSize;
      statsdMetrics['influxdbStats.num_stats'] = self.influxdbStats.numStats;
    }

    for (key in statsdMetrics) {
      var value = statsdMetrics[key],
          k = self.prefixStats + '.' + key;

      if (!isNaN(parseFloat(value)) && isFinite(value)) {
        points.push(self.assembleEvent(k, [{value: value, time: timestamp}]));
      }
    }
  }
  self.httpPOST(points);
  self.influxdbStats.flushTime = millisecondsSince(startTime);
}

InfluxdbBackend.prototype.addTypeToKey = function (key, type) {
  key = key.split(',');
  key[0] = key[0] + '.' + type;
  return key.join();
}

InfluxdbBackend.prototype.processPacket = function (packet, rinfo, metrics) {
  var self = this;
  metrics.counters[packets_received]++;
  var packet_data = packet.toString();
  if (packet_data.indexOf("\n") > -1) {
    points = packet_data.split("\n");
  } else {
    points = [ packet_data ] ;
  }

  for (var midx in points) {
    if (points[midx].length === 0) {
      continue;
    }

    var bits = points[midx].toString().split(':');
    var key = bits.shift();

    if (bits.length === 0) {
      bits.push("1");
    }

    for (var i = 0; i < bits.length; i++) {
      var sampleRate = 1;
      var fields = bits[i].split("|");
      if (!self.isValidPacket(fields)) {
          self.log('Bad line: ' + fields + ' in msg "' + metrics[midx] +'"');
          metrics.counters[bad_lines_seen]++;
          continue;
      }

      var metric_type = fields[1].trim();
      if (metric_type === "ms") {
        self.log("Unsuported type timer");
        continue
      } else if (metric_type === "g") {
        self.log("Unsuported type gauge");
        continue
      } else if (metric_type === "s") {
        self.log("Unsuported type set");
        continue
      } else if (metric_type === "b") {
        if (fields[2]) {
          ts = Number(fields[2].trim());
        }
        if (! metrics.backfills[key]) {
          metrics.backfills[key] = [];
        }
        metrics.backfills[key].push({value: Number(fields[0] || 1), timestamp: ts});
      } else {
        if (! metrics.counters[key]) {
          metrics.counters[key] = 0;
        }
        metrics.counters[key] += Number(fields[0] || 1) * (1 / sampleRate);
      }
    }
  }
}

InfluxdbBackend.prototype.isValidPacket = function (fields) {
  // test for existing metrics type
  if (fields[1] === undefined) {
    return false;
  }

  // filter out invalid metrics values
  switch(fields[1]) {
    case 's':
      return true;
    case 'g':
      return isNumber(fields[0]);
    case 'ms':
      return isNumber(fields[0]) && Number(fields[0]) >= 0;
    case 'b':
      return isNumber(fields[0]) && Number(fields[0]) >= 0;
    default:
      if (!isNumber(fields[0])) {
        return false;
      }
      return true;
  }
}

InfluxdbBackend.prototype.assembleEvent_v08 = function (name, events) {
  var self = this;

  var payload = {
    name: name,
    columns: Object.keys(events[0]),
    points: []
  };

  for (var idx in events) {
    var event = events[idx],
        points = [];

    for (var cidx in payload.columns) {
      var column = payload.columns[cidx];

      points.push(event[column]);
    }

    payload.points.push(points);
  }

  return payload;
}

InfluxdbBackend.prototype.assembleEvent_v09 = function (name, events) {
  var self = this;
  var sum = 0;

  var payload = {
    measurement: name,
    fields: { value: events[0]['value'], timestamp: events[0]['timestamp'] }
  }

  return payload;
}

InfluxdbBackend.prototype.httpPOST_v08 = function (points) {
  /* Do not send if there are no points. */
  if (!points.length) { return; }

  var self = this,
      query = {u: self.user, p: self.pass, time_precision: 'ms'},
      protocolName = self.protocol == http ? 'HTTP' : 'HTTPS',
      startTime;

  self.logDebug(function () {
    return 'Sending ' + points.length + ' different points via ' + protocolName;
  });

  self.influxdbStats.numStats = points.length;

  var options = {
    hostname: self.host,
    port: self.port,
    path: '/db/' + self.database + '/series?' + querystring.stringify(query),
    method: 'POST',
    agent: false // Is it okay to use "undefined" here? (keep-alive)
  };

  var req = self.protocol.request(options);

  req.on('socket', function (res) {
    startTime = process.hrtime();
  });

  req.on('response', function (res) {
    var status = res.statusCode;

    self.influxdbStats.httpResponseTime = millisecondsSince(startTime);

    if (status !== 200) {
      self.log(protocolName + ' Error: ' + status);
    }
  });

  req.on('error', function (e, i) {
    self.log(e);
  });

  var payload = JSON.stringify(points)
  self.influxdbStats.payloadSize = Buffer.byteLength(payload);

  self.logDebug(function () {
    var size = (self.influxdbStats.payloadSize / 1024).toFixed(2);
    return 'Payload size ' + size + ' KB';
  });

  req.write(payload);
  req.end();
}

InfluxdbBackend.prototype.httpPOST_v09 = function (points) {
  /* Do not send if there are no points. */
  if (!points.length) { return; }

  var self = this,
      query = {u: self.user, p: self.pass, db: self.database, precision: 's'},
      protocolName = self.protocol == http ? 'HTTP' : 'HTTPS',
      startTime;

  self.logDebug(function () {
    return 'Sending ' + points.length + ' different points via ' + protocolName;
  });

  self.influxdbStats.numStats = points.length;

  var options = {
    hostname: self.host,
    port: self.port,
    path: '/write?' + querystring.stringify(query),
    method: 'POST',
    agent: false // Is it okay to use "undefined" here? (keep-alive)
  };

  var req = self.protocol.request(options);

  req.on('socket', function (res) {
    startTime = process.hrtime();
  });

  req.on('response', function (res) {
    var status = res.statusCode;

    self.influxdbStats.httpResponseTime = millisecondsSince(startTime);

    if (status >= 400) {
      self.log(protocolName + ' Error: ' + status);
    }
  });

  req.on('error', function (e, i) {
    self.log(e);
  });

  var points_to_payload = function(points) {
    // {"database":"statsd","points":[{"measurement":"my.test.cnt,host=server1,name=abc.gauge","fields":{"value":56}}]}
    lines = '';
    for (p in points) {
      p = points[p];
      var timestamp = p['fields']['timestamp'] != undefined ? " " + p['fields']['timestamp'] : '';
      var l = p['measurement'] + ' value=' + p['fields']['value'] + timestamp;
      lines += l + "\n";
    }
    return lines;
  };

  var payload = points_to_payload(points);

  self.influxdbStats.payloadSize = Buffer.byteLength(payload);

  self.logDebug(function () {
    var size = (self.influxdbStats.payloadSize / 1024).toFixed(2);
    return 'Payload size ' + size + ' KB';
  });

  self.logDebug(function () {
    return "Payload: \n" + payload;
  });
  req.write(payload);
  req.end();
}

InfluxdbBackend.prototype.configCheck = function () {
  var self = this,
      success = true;

  /* Make sure the database name is configured. */
  if (!self.database) {
    self.log('Missing config option: database');
    success = false;
  }

  return success;
}

exports.init = function (startupTime, config, events) {
  var influxdb = new InfluxdbBackend(startupTime, config, events);

  return influxdb.configCheck();
}
