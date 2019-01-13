const { expect } = require('chai');
const sinon = require('sinon');
const request = require('supertest');
const express = require('express');
const WebpackDevMiddleware = require('webpack-dev-middleware');
const MemoryFS = require('memory-fs');
const dummyLoader = require('./dummyLoader');
const LazyBuild = require('..');

const dummyLoaderPath = require.resolve('./dummyLoader');
const dummyLoaderContent = `module.exports=${dummyLoader.toString()}`;

runTests('webpack-v4');
runTests('webpack-v3');

function runCompiler(compiler) {
  return new Promise((resolve, reject) => {
    compiler.run((err, stats) => {
      if (err) {
        reject(err);
      } else if (stats.hasErrors()) {
        reject(stats.compilation.errors[0]);
      } else {
        resolve(stats);
      }
    });
  });
}

function createDonePlugin(doneCallback) {
  return function() {
    const hasHooks = Boolean(this.hooks);
    if (hasHooks) {
      this.hooks.done.tap('MyTestPlugin', doneCallback);
    } else {
      this.plugin('done', doneCallback);
    }
  };
}

function setCompilerFs(compiler, fs) {
  compiler.inputFileSystem = fs;
  compiler.outputFileSystem = fs;
  compiler.resolvers.normal.fileSystem = fs;
  compiler.resolvers.context.fileSystem = fs;
}

function runTests(webpackPath) {
  const webpack = require(webpackPath);

  describe(`LazyBuild (webpack ${webpack.version || '3.11.0'})`, () => {
    let auxWebpackModule;

    before(() => {
      auxWebpackModule = require.cache[require.resolve('webpack')];
      require.cache[require.resolve('webpack')] = require.cache[require.resolve(webpackPath)];
    });

    after(() => {
      require.cache[require.resolve('webpack')] = auxWebpackModule;
    });

    it('should be a function', () => {
      expect(LazyBuild).to.be.a('function');
    });
  
    describe('#lazyBuild', () => {
      it('should block assets from building', async () => {
        const baseConfig = {
          entry: '/in',
          output: { filename: 'out.js', path: '/' },
        };
        const lazyBuild = new LazyBuild();
        const baseCompiler = webpack(baseConfig);
        const lazyCompiler = webpack({ ...baseConfig, plugins: [lazyBuild.createPlugin()] });
        const fs = new MemoryFS();
        fs.writeFileSync('/in.js', 'import("./1")', 'utf-8');
        fs.writeFileSync('/1.js', 'console.log("1.js loaded")', 'utf-8');
        setCompilerFs(baseCompiler, fs);
        setCompilerFs(lazyCompiler, fs);
        const baseStats = await runCompiler(baseCompiler);
        expect(Object.keys(baseStats.compilation.assets)).to.have.length(2);
        const lazyStats = await runCompiler(lazyCompiler);
        expect(Object.keys(lazyStats.compilation.assets)).to.deep.equal(['out.js']);
      });
  
      if (!webpack.version) {  // version < 4.0.0
        it('should not run loader for entry file', async () => {
          const baseConfig = {
            entry: '/in',
            output: { filename: 'out.js', path: '/' },
            module: { rules: [{ use: require.resolve('./dummyLoader') }] }, 
          };
          const lazyBuild = new LazyBuild();
          const baseCompiler = webpack(baseConfig);
          const lazyCompiler = webpack({ ...baseConfig, plugins: [lazyBuild.createPlugin()] });
          const fs = new MemoryFS();
          fs.writeFileSync('/in.js', 'console.log("in.js loaded")', 'utf-8');
          setCompilerFs(baseCompiler, fs);
          setCompilerFs(lazyCompiler, fs);
    
          dummyLoader.loader = sinon.spy(s => s);
          await runCompiler(baseCompiler);
          sinon.assert.callCount(dummyLoader.loader, 1);
    
          dummyLoader.loader = sinon.spy(s => s);
          await runCompiler(lazyCompiler);
          sinon.assert.callCount(dummyLoader.loader, 0);
        });
      }
  
      it('should block array entry from building', async () => {
        const baseConfig = {
          entry: ['/in1', '/in2'],
          output: { filename: 'out.js', path: '/' },
        };
        const lazyBuild = new LazyBuild();
        const baseCompiler = webpack(baseConfig);
        const lazyCompiler = webpack({ ...baseConfig, plugins: [lazyBuild.createPlugin()] });
        const fs = new MemoryFS();
        fs.writeFileSync('/in1.js', 'console.log("in1.js loaded")', 'utf-8');
        fs.writeFileSync('/in2.js', 'console.log("in2.js loaded")', 'utf-8');
        setCompilerFs(baseCompiler, fs);
        setCompilerFs(lazyCompiler, fs);
        const baseStats = await runCompiler(baseCompiler)
        expect(baseStats.compilation.assets['out.js'].source()).to.not.include('No source available');
        const lazyStats = await runCompiler(lazyCompiler)
        expect(lazyStats.compilation.assets['out.js'].source()).to.include('No source available');
      });
    });
  
    describe('Middleware', () => {
      let devMiddleware = null;

      afterEach((cb) => {
        if (devMiddleware) {
          devMiddleware.close(cb);
          devMiddleware = null;
        }
      });

      function createAppRequest(webpackConfig, fsConfig) {
        const lazyBuild = new LazyBuild();
        const configs = Array.isArray(webpackConfig) ? webpackConfig : [webpackConfig];
        configs.forEach((config) => {
          if (webpack.version) config.mode = 'none';
          if (!config.plugins) config.plugins = [];
          config.plugins.push(lazyBuild.createPlugin(), new webpack.NamedChunksPlugin());
        });
        const fs = new MemoryFS();
        for (filePath in fsConfig) {
          fs.writeFileSync(filePath, fsConfig[filePath], 'utf-8');
        }
        const compiler = webpack(webpackConfig);
        const compilers = compiler.compilers || [compiler];
        compilers.forEach((c) => setCompilerFs(c, fs));
        devMiddleware = WebpackDevMiddleware(compiler, {
          publicPath: !Array.isArray(webpackConfig) && webpackConfig.output.publicPath,
          logLevel: 'silent',
          stats: false,
        });
        const app = express();
        app.use(lazyBuild.createMiddleware(devMiddleware));
        const appRequest = request(app);
        return new Promise((resolve, reject) => {
          devMiddleware.waitUntilValid((stats) => {
            if (stats.hasErrors()) {
              const cStats = stats.stats ? stats.stats.find(s => s.compilation.errors.length) : stats;
              return reject(cStats.compilation.errors[0]);
            }
            resolve(appRequest);
          });
        });
      }
  
      it('should respond 404 to path with no asset', async () => {
        const appRequest = await createAppRequest({
          entry: '/in',
          output: { filename: '[name].js', path: '/' },
        }, {
          '/in.js': 'console.log("hello world")',
        });
        await appRequest.get('/').expect(404);
      });
  
      it('should respond 200 to path with asset', async () => {
        const appRequest = await createAppRequest({
          entry: '/in',
          output: { filename: '[name].js', path: '/' },
        }, {
          '/in.js': 'console.log("hello world")',
        });
        await appRequest.get('/main.js').expect(200);
      });
  
      it('should find source of requested asset', async () => {
        const appRequest = await createAppRequest({
          entry: '/in',
          output: { filename: '[name].js', path: '/' },
        }, {
          '/in.js': 'console.log("hello world")',
        });
        const res = await appRequest.get('/main.js');
        expect(res.text).to.not.include('No source available');
      });
  
      it('should find source of requested asset when output path does not ends with a slash', async () => {
        const appRequest = await createAppRequest({
          entry: '/in',
          output: { filename: '[name].js', path: '/out', publicPath: '/out' },
        }, {
          '/in.js': 'console.log("hello world")',
        });
        const res = await appRequest.get('/out/main.js').expect(200);
        expect(res.text).to.not.include('No source available');
      });
  
      it('should not build chunk that is a child of entry', async () => {
        const appRequest = await createAppRequest({
          entry: '/in',
          output: { filename: '[name].js', path: '/' },
        }, {
          '/in.js': 'import("./in1")',
          '/in1.js': 'console.log("in1.js loaded")',
        });
        await appRequest.get('/1.js').expect(404);
      });
  
      it('should build child chunk when entry is requested', async () => {
        let assets = [];
        const appRequest = await createAppRequest({
          entry: '/in',
          output: { filename: '[name].js', path: '/' },
          plugins: [createDonePlugin((stats) => {
            assets = Object.keys(stats.compilation.assets);
          })],
        }, {
          '/in.js': 'import( /* webpackChunkName: "chunk" */ "./chunk")',
          '/chunk.js': 'console.log("chunk.js loaded")',
        });
        await appRequest.get('/main.js').expect(200);
        expect(assets).to.include('chunk.js');
      });
  
      it('should respond 200 to path with asset when using publicPath', async () => {
        const appRequest = await createAppRequest({
          entry: '/in',
          output: { filename: '[name].js', path: '/', publicPath: '/public/' },
        }, {
          '/in.js': 'console.log("hello world")',
        });
        return appRequest.get('/public/main.js').expect(200);
      });
  
      it('should build child chunk when entry is requested using publicPath', async () => {
        let assets = [];
        const appRequest = await createAppRequest({
          entry: '/in',
          output: { filename: '[name].js', path: '/', publicPath: '/public/' },
          plugins: [createDonePlugin((stats) => {
            assets = Object.keys(stats.compilation.assets);
          })],
        }, {
          '/in.js': 'import( /* webpackChunkName: "chunk" */ "./chunk")',
          '/chunk.js': 'console.log("chunk.js loaded")',
        });
        await appRequest.get('/public/main.js').expect(200);
        expect(assets).to.include('chunk.js');
      });
  
      it('should not build child chunk of not requested entry', async () => {
        let assets = [];
        const appRequest = await createAppRequest({
          entry: { out1: '/in1', out2: '/in2' },
          output: { filename: '[name].js', path: '/' },
          plugins: [createDonePlugin((stats) => {
            assets = Object.keys(stats.compilation.assets);
          })],
        }, {
          '/in1.js': 'import("./1")',
          '/in2.js': 'import("./2")',
          '/1.js': 'console.log("1.js loaded")',
          '/2.js': 'console.log("2.js loaded")',
        });
        await appRequest.get('/out1.js').expect(200);
        expect(assets).to.have.length(3);
      });
  
      it('should not build child chunk of entry child chunk', async () => {
        let assets = [];
        const appRequest = await createAppRequest({
          entry: '/in',
          output: { filename: '[name].js', path: '/' },
          plugins: [createDonePlugin((stats) => {
            assets = Object.keys(stats.compilation.assets);
          })],
        }, {
          '/in.js': 'import("./1")',
          '/1.js': 'import("./2")',
          '/2.js': 'console.log("2.js loaded")',
        });
        await appRequest.get('/main.js').expect(200);
        expect(assets).to.have.length(2);
      });
  
      it('should work with the CachePlugin', async () => {
        let assets = [];
        const appRequest = await createAppRequest({
          entry: '/in',
          output: { filename: '[name].js', path: '/' },
          plugins: [new webpack.CachePlugin()],
        }, {
          '/in.js': '() => {import( /* webpackChunkName: "chunk" */ "./chunk")}',
          '/chunk.js': 'import("./in")',
        });
        await appRequest.get('/main.js').expect(200);
        await appRequest.get('/chunk.js').expect(200);
      });

      it('should process js file when requesting css file', async () => {
        const cssBody = 'body { background: red }';
        const appRequest = await createAppRequest({
          entry: '/in',
          output: { filename: 'main.js', path: '/' },
          module: {
            rules: [
              {
                test: /\.css$/,
                use: { loader: 'file-loader', options: { name: '[name].[ext]' } },
              },
            ],
          },
        }, {
          '/in.js': 'import "./main.css";',
          '/main.css': cssBody,
        });
        const res = await appRequest.get('/main.css').expect(200);
        expect(res.text).to.equal(cssBody);
      });
  
      describe('multicompiler', () => {
        it('should not compile assets from not modified compiler', async () => {
          const done2 = sinon.spy();
          let assets2 = [];
          const appRequest = await createAppRequest([{
            entry: '/in1',
            output: { filename: '[name].js', path: '/out1/', publicPath: '/public1/' },
          }, {
            entry: '/in2',
            output: { filename: '[name].js', path: '/out2/', publicPath: '/public2/' },
            plugins: [createDonePlugin((stats) => {
              assets2 = Object.keys(stats.compilation.assets);
              done2();
            })],
          }], {
            '/in1.js': 'import("./1")',
            '/in2.js': 'import("./2")',
            '/1.js': 'console.log("1.js loaded")',
            '/2.js': 'console.log("2.js loaded")',
          });
          await appRequest.get('/public1/main.js').expect(200);
          sinon.assert.callCount(done2, 1);
          expect(assets2).to.have.length(1);
        });
  
        it('should compile assets from modified compiler', async () => {
          const done1 = sinon.spy();
          let assets1 = [];
          const appRequest = await createAppRequest([{
            entry: '/in1',
            output: { filename: '[name].js', path: '/out1/', publicPath: '/public1/' },
            plugins: [createDonePlugin((stats) => {
              assets1 = Object.keys(stats.compilation.assets);
              done1();
            })],
          }, {
            entry: '/in2',
            output: { filename: '[name].js', path: '/out2/', publicPath: '/public2/' },
          }], {
            '/in1.js': 'import("./1")',
            '/in2.js': 'import("./2")',
            '/1.js': 'console.log("1.js loaded")',
            '/2.js': 'console.log("2.js loaded")',
          });
          const res = await appRequest.get('/public1/main.js').expect(200);
          expect(res.text).to.not.include('No source available');
          sinon.assert.callCount(done1, 2);
          expect(assets1).to.have.length(2);
        });
      });
    });
  });  
}