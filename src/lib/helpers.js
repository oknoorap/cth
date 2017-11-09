const path = require('path')
const {existsSync, statSync, readFileSync} = require('fs')

const isFileExists = (...files) => {
  const filepath = path.join(...files)
  return existsSync(filepath) && statSync(filepath).isFile()
}

const isDirExists = (...dirs) => {
  const dirpath = path.join(...dirs)
  return existsSync(dirpath) && statSync(dirpath).isDirectory()
}

const readFile = (...dirs) => {
  if (isFileExists(...dirs)) {
    return readFileSync(path.join(...dirs), 'utf-8')
  }

  return ''
}

exports.isFileExists = isFileExists
exports.isDirExists = isDirExists
exports.readFile = readFile
