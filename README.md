# webpack-lazy-dev-build

Extends the `webpack-dev-middleware` to support lazy loading of assets.

Useful when you have multiple entry points, multiple compilers or you are using dynamic imports.
If starting the development server is taking you a long time, you are using code splitting
and you don't need all assets to be compiled when the server is started, then this package is for you.

## Install

```sh
npm install --save-dev webpack-lazy-dev-build
```

## Minimum setup

```js
const express = require('express');
const WebpackDevMiddleware = require('webpack-dev-middleware');
const LazyBuild = require('webpack-lazy-dev-build');
const webpackConfig = require('./webpack.config');

const lazyBuild = new LazyBuild();
webpackConfig.plugins.push(lazyBuild.plugin);
const compiler = webpack(webpackConfig);
const devMiddleware = WebpackDevMiddleware(compiler);
const app = express();

app.use(lazyBuild.createMiddleware(devMiddleware));

app.listen(3000);
```

## How it works

When the development server is started, no assets are compiled.
When the browser requests an entry point, that specific asset is compiled at that moment.

The difference with the lazy mode of `webpack-dev-middleware` is that when an asset is compiled, it is cached.
The second time the asset is requested, no compilation is done.
When a file is changed, it will trigger a recompilation of dependant assets that were already compiled.
It's like a mix of `watch` and `lazy` mode.

You can check an example at [webpack-lazy-dev-build-example](https://github.com/tfoxy/webpack-lazy-dev-build-example/).
