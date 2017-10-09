/* eslint-disable no-console */
const chalk = require('chalk')
const ora = require('ora')

const msgRegx = /\{(.[^{]*)\}/g

const lf = () => {
  console.log('')
}
exports.lf = lf

const info = (...msg) => {
  console.log(`${msg.map(item => `  ${item.replace(msgRegx, `${chalk.bold.cyan('$1')}`)}`).join('')}`)
}
exports.info = info

const blank = (...msg) => {
  lf()
  info(...msg)
  lf()
}
exports.blank = blank

exports.error = err => {
  const msg = err.message || err
  blank(chalk.red(msg))
  /* eslint-disable unicorn/no-process-exit */
  process.exit(1)
  /* eslint-enable unicorn/no-process-exit */
}

exports.success = msg => {
  blank(chalk.green(msg))
}

exports.loader = msg => {
  const loader = ora(msg.replace(msgRegx, `${chalk.bold.cyan('$1')}`))
  loader.spinner = {
    interval: 70,
    frames: [
      '.  ',
      '.. ',
      ' ..',
      ' ..',
      '  .',
      '   '
    ]
  }
  return loader.start()
}
