const path = require('path')
const {existsSync, statSync, readFileSync} = require('fs')

const isFileExists = (...files) => {
  return existsSync(path.join(...files)) && statSync(path.join(...files)).isFile()
}

const isDirExists = (...dirs) => {
  return existsSync(path.join(...dirs)) && statSync(path.join(...dirs)).isDirectory()
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
