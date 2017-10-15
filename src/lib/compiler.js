const path = require('path')
const {writeFileSync, readdirSync, readFileSync, statSync, existsSync} = require('fs')
const mkdirp = require('mkdirp')
const hbs = require('handlebars')
const wpautop = require('wpautop')
const sample = require('lodash.samplesize')

hbs.registerHelper('fakevar', val => `{{${val}}}`)
hbs.registerHelper('autop', val => wpautop(val))
hbs.registerHelper('related', (items, length = 1, options) => {
  let out = ''

  if (items && Array.isArray(items)) {
    length = (length < 1) ? 1 : length
    const randItems = sample(items, length)
    for (let i = 0; i < length; i++) {
      out += options.fn(randItems[i])
    }
  }

  return out
})

const scandir = dir => readdirSync(dir)

const fileCompiler = ({srcPath, dstPath, syntax}) => {
  const input = readFileSync(srcPath, 'ascii')
  let output = input

  if (syntax) {
    const compiler = hbs.compile(input)
    output = compiler(syntax)
  }

  if (['.html', '.css', '.xml'].includes(path.extname(dstPath))) {
    output = HTMLMinify(output, {
      collapseWhitespace: true
    })
  }

  writeFileSync(dstPath, output, 'utf-8')
}

const bulkCompiler = ({srcDir, dstDir, includes = [], excludes = [], rename = {}, syntax = {}, tree = 0}) => {
  let _files = scandir(srcDir)
  let _includes = []
  let _excludes = []

  if (tree === 0) {
    excludes.forEach(item => {
      const dirname = path.dirname(item)
      if (dirname !== '.' && _excludes.includes(dirname)) {
        _excludes.push(dirname)
      }
    })

    _excludes = _excludes.concat(excludes).map(item => path.join(srcDir, item))

    includes.forEach(item => {
      const dirname = path.dirname(item)
      if (dirname !== '.' && !_includes.includes(dirname)) {
        _includes.push(dirname)
      }
    })

    _includes = _includes.concat(includes).map(item => path.join(srcDir, item))
  } else {
    _includes = includes
    _excludes = excludes
  }

  if (_excludes.length > 0) {
    _files = _files.filter(item => {
      return !_excludes.includes(path.join(srcDir, item))
    })
  }

  if (_includes.length > 0) {
    _files = _files.filter(item => {
      return _includes.includes(path.join(srcDir, item))
    })
  }

  _files.forEach(filename => {
    const srcPath = path.join(srcDir, filename)
    const dstPath = path.join(dstDir, (filename in rename) ? rename[filename] : filename)

    if (existsSync(srcPath)) {
      if (statSync(srcPath).isFile()) {
        fileCompiler({srcPath, dstPath, syntax})
      }

      if (statSync(srcPath).isDirectory()) {
        mkdirp.sync(dstPath)
        bulkCompiler({
          srcDir: srcPath,
          dstDir: dstPath,
          excludes: _excludes,
          includes: _includes,
          tree: tree + 1,
          rename,
          syntax
        })
      }
    }
  })
}

exports.bulk = bulkCompiler
exports.single = fileCompiler
exports.scandir = scandir
