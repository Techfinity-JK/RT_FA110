const ZKLibTCP = require('node-zklib/zklibtcp');
const { COMMANDS } = require('node-zklib/constants');

// ZKTeco comm key derivation algorithm from the ZKOSS SDK spec
function makeCommKey(key, sessionId) {
  let k = 0;
  for (let i = 0; i < 32; i++) {
    if (key & 1) k ^= (sessionId ^ 0x185CC18);
    key = key >>> 1;
    sessionId = sessionId >>> 1;
  }
  return k >>> 0;
}

// Patch connect() to handle CMD_ACK_UNAUTH → CMD_AUTH flow.
// Sets this.commKey on the ZKLibTCP instance before calling createSocket
// to enable authenticated connections.
ZKLibTCP.prototype.connect = async function () {
  const reply = await this.executeCmd(COMMANDS.CMD_CONNECT, '');
  if (!reply) throw new Error('NO_REPLY_ON_CMD_CONNECT');

  const commandId = reply.readUInt16LE(0);

  if (commandId === COMMANDS.CMD_ACK_UNAUTH) {
    if (!this.commKey) throw new Error('DEVICE_REQUIRES_COMM_KEY — set commKey on ZKLibTCP instance');

    const authVal = makeCommKey(this.commKey, this.sessionId);
    const authBuf = Buffer.alloc(4);
    authBuf.writeUInt32LE(authVal, 0);

    const authReply = await this.executeCmd(COMMANDS.CMD_AUTH, authBuf);
    if (!authReply) throw new Error('NO_REPLY_ON_CMD_AUTH');

    const authCmd = authReply.readUInt16LE(0);
    if (authCmd !== COMMANDS.CMD_ACK_OK) {
      throw new Error(`AUTH_FAILED (cmd=${authCmd}) — wrong comm key?`);
    }
  }

  return true;
};

module.exports = { makeCommKey };
