StatsD InfluxDB backend
-----------------------

A naive [InfluxDB](http://influxdb.org/) backend for
[StatsD](https://github.com/etsy/statsd).

It can ship events to InfluxDB using two different strategies which can be
used at the same time.

### Regular Flush Strategy

StatsD will flush aggregated metrics with a configured interval. This is
the regular StatsD mode of operation.

### Proxy Strategy

This will map every incoming StatsD packet to an InfluxDB event. It's useful
if you want to store the raw events in InfluxDB without any rollups.

## CAVEATS

This is pretty young and I do not have much experience with InfluxDB yet.
Especially the event buffering and the event mapping might be problematic
and inefficient.

InfluxDB is also pretty young and there might be breaking changes until it
reaches 1.0.

Please be careful!

## Installation

    $ cd /path/to/statsd
    $ npm install statsd-influxdb-backend

## Configuration

You can configure the following settings in your StatsD config file.

```js
{
  graphitePort: 2003,
  graphiteHost: "graphite.example.com",
  port: 8125,
  backends: [ "./backends/graphite", "statsd-influxdb-backend" ],

  influxdb: {
    host: '127.0.0.1',   // InfluxDB host. (default 127.0.0.1)
    port: 8086,          // InfluxDB port. (default 8086)
    ssl: false,          // InfluxDB is hosted over SSL. (default false)
    database: 'dbname',  // InfluxDB database instance. (required)
    username: 'user',    // InfluxDB database username. (required)
    password: 'pass',    // InfluxDB database password. (required)
    flush: {
      enable: true       // Enable regular flush strategy. (default true)
    },
    proxy: {
      enable: false,       // Enable the proxy strategy. (default false)
      suffix: 'raw',       // Metric name suffix. (default 'raw')
      flushInterval: 1000  // Flush interval for the internal buffer.
                           // (default 1000)
    }
  }
}
```

## Activation

Add the `statsd-influxdb-backend` to the list of StatsD backends in the config
file and restart the StatsD process.

```js
{
  backends: ['./backends/graphite', 'statsd-influxdb-backend']
}
```

## Unsupported Metric Types

#### Flush Strategy

* Sets

#### Proxy Strategy

* Counter with sampling.
* Signed gauges. (i.e. `bytes:+4|g`)
* Sets

## InfluxDB Event Mapping

StatsD packets are currently mapped to the following InfluxDB events. This is
a first try and I'm open to suggestions to improve this.

### Counter

StatsD packet `requests:1|c` as InfluxDB event:

#### Flush Strategy

```js
[
  {
    name: 'requests.counter',
    columns: ['value', 'time'],
    points: [[802, 1384798553000]]
  }
]
```

#### Proxy Strategy

```js
[
  {
    name: 'requests.counter.raw',
    columns: ['value', 'time'],
    points: [[1, 1384472029572]]
  }
]
```

### Timing

StatsD packet `response_time:170|ms` as InfluxDB event:

#### Flush Strategy

```js
[
  {
    name: 'response_time.timer.mean_90',
    columns: ['value', 'time'],
    points: [[445.25761772853184, 1384798553000]]
  },
  {
    name: 'response_time.timer.upper_90',
    columns: ['value', 'time'],
    points: [[905, 1384798553000]]
  },
  {
    name: 'response_time.timer.sum_90',
    columns: ['value', 'time'],
    points: [[321476, 1384798553000]]
  },
  {
    name: 'response_time.timer.std',
    columns: ['value', 'time'],
    points: [[294.4171159604542, 1384798553000]]
  },
  {
    name: 'response_time.timer.upper',
    columns: ['value', 'time'],
    points: [[998, 1384798553000]]
  },
  {
    name: 'response_time.timer.lower',
    columns: ['value', 'time'],
    points: [[2, 1384798553000]]
  },
  {
    name: 'response_time.timer.count',
    columns: ['value', 'time'],
    points: [[802, 1384798553000]]
  },
  {
    name: 'response_time.timer.count_ps',
    columns: ['value', 'time'],
    points: [[80.2, 1384798553000]]
  },
  {
    name: 'response_time.timer.sum',
    columns: ['value', 'time'],
    points: [[397501, 1384798553000]]
  },
  {
    name: 'response_time.timer.mean',
    columns: ['value', 'time'],
    points: [[495.6371571072319, 1384798553000]]
  },
  {
    name: 'response_time.timer.median',
    columns: ['value', 'time'],
    points: [[483, 1384798553000]]
  }
]
```

#### Proxy Strategy

```js
[
  {
    name: 'response_time.timer.raw',
    columns: ['value', 'time'],
    points: [[170, 1384472029572]]
  }
]
```

### Gauges

StatsD packet `bytes:123|g` as InfluxDB event:

#### Flush Strategy

```js
[
  {
    name: 'bytes.gauge',
    columns: ['value', 'time'],
    points: [[123, 1384798553000]]
  }
]
```

#### Proxy Strategy

```js
[
  {
    name: 'bytes.gauge.raw',
    columns: ['value', 'time'],
    points: [['gauge', 123, 1384472029572]]
  }
]
```

## Proxy Strategy Notes

### Event Buffering

To avoid one HTTP request per StatsD packet, the InfluxDB backend buffers the
incoming events and flushes the buffer on a regular basis. The current default
is 1000ms. Use the `influxdb.proxy.flushInterval` to change the interval.

This might become a problem with lots of incoming events.

The payload of a HTTP request might look like this:

```js
[
  {
    name: 'requests.counter.raw',
    columns: ['value', 'time'],
    points: [
      [1, 1384472029572],
      [1, 1384472029573],
      [1, 1384472029580]
    ]
  },
  {
    name: 'response_time.timer.raw',
    columns: ['value', 'time'],
    points: [
      [170, 1384472029570],
      [189, 1384472029572],
      [234, 1384472029578],
      [135, 1384472029585]
    ]
  },
  {
    name: 'bytes.gauge.raw',
    columns: ['value', 'time'],
    points: [
      [123, 1384472029572],
      [123, 1384472029580]
    ]
  }
]
```

## Contributing

All contributions are welcome: ideas, patches, documentation, bug reports,
complaints, and even something you drew up on a napkin.
