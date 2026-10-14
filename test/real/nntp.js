// -----------------------------------------------------------------------------
// A tiny Usenet (NNTP) server for the real-software tests (npm run test:real):
// it serves yEnc-encoded articles generated in memory, so a real SABnzbd or
// NZBGet can download, verify and post-process a job without any Usenet
// account. Also builds the matching NZB files.
//
// Enough of RFC 3977 for both clients: greeting, CAPABILITIES, MODE READER,
// AUTHINFO, GROUP, ARTICLE/BODY/HEAD/STAT, DATE, QUIT. An unknown message id
// answers 430 (the article is missing: the job fails). `bytesPerSecond`
// throttles the bodies so a download lasts long enough to be observed.
// -----------------------------------------------------------------------------

import net from 'node:net';
import { crc32 } from 'node:zlib';

const LINE_LENGTH = 128;
const GROUP = 'alt.binaries.gladys.test';

/** yEnc-encode one segment of a file (yEnc 1.3, multipart). */
export function yencode(data, { name, part, total, begin, fileSize }) {
  const lines = [];
  let line = '';
  for (let i = 0; i < data.length; i += 1) {
    let code = (data[i] + 42) % 256;
    const atEdge = line.length === 0 || line.length === LINE_LENGTH - 1;
    if (
      code === 0 ||
      code === 10 ||
      code === 13 ||
      code === 61 ||
      (atEdge && (code === 9 || code === 32 || code === 46))
    ) {
      line += '=';
      code = (code + 64) % 256;
    }
    line += String.fromCharCode(code);
    if (line.length >= LINE_LENGTH) {
      lines.push(line);
      line = '';
    }
  }
  if (line) {
    lines.push(line);
  }
  const end = begin + data.length - 1;
  const crc = crc32(data).toString(16).padStart(8, '0');
  return [
    `=ybegin part=${part} total=${total} line=${LINE_LENGTH} size=${fileSize} name=${name}`,
    `=ypart begin=${begin} end=${end}`,
    ...lines,
    `=yend size=${data.length} part=${part} pcrc32=${crc}`,
  ].join('\r\n');
}

/** Deterministic pseudo-random bytes (incompressible, reproducible). */
function bytes(size, seed) {
  const buffer = Buffer.alloc(size);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < size; i += 1) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    buffer[i] = x & 0xff;
  }
  return buffer;
}

export class NntpServer {
  constructor({ bytesPerSecond = 0 } = {}) {
    this.bytesPerSecond = bytesPerSecond;
    /** message id (without <>) -> latin1 article body */
    this.articles = new Map();
    this.sockets = new Set();
    this.server = net.createServer((socket) => this.session(socket));
    this.seed = 1;
  }

  listen(port = 0, host = '127.0.0.1') {
    return new Promise((resolve) => {
      this.server.listen(port, host, () => resolve(this.server.address().port));
    });
  }

  close() {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  /**
   * Generate a file cut in segments and return the NZB that points at them.
   * @param {object} options
   * @param {string} options.name job name (also the file name, `.bin`)
   * @param {number} options.size bytes
   * @param {number} [options.segmentSize]
   * @param {boolean} [options.missing] publish the NZB without the articles: the job fails
   */
  addJob({ name, size, segmentSize = 256 * 1024, missing = false }) {
    const file = `${name}.bin`;
    const data = bytes(size, (this.seed += 7919));
    const total = Math.ceil(size / segmentSize);
    const segments = [];
    for (let part = 1; part <= total; part += 1) {
      const begin = (part - 1) * segmentSize;
      const chunk = data.subarray(begin, begin + segmentSize);
      const id = `${name}.${part}.${this.seed}@gladys.test`;
      const body = yencode(chunk, { name: file, part, total, begin: begin + 1, fileSize: size });
      if (!missing) {
        this.articles.set(id, body);
      }
      segments.push({ id, bytes: Buffer.byteLength(body, 'latin1'), part });
    }
    const date = Math.floor(Date.now() / 1000);
    const subject = `${name} - "${file}" yEnc (1/${total})`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.1//EN" "http://www.newzbin.com/DTD/nzb/nzb-1.1.dtd">
<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">
  <file poster="gladys@gladys.test" date="${date}" subject="${subject.replace(/"/g, '&quot;')}">
    <groups><group>${GROUP}</group></groups>
    <segments>
${segments.map((s) => `      <segment bytes="${s.bytes}" number="${s.part}">${s.id}</segment>`).join('\n')}
    </segments>
  </file>
</nzb>
`;
  }

  session(socket) {
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => {});
    socket.setEncoding('latin1');
    let buffer = '';
    let queue = Promise.resolve();
    const write = (text) => {
      if (!socket.destroyed) {
        socket.write(text, 'latin1');
      }
    };
    write('200 gladys-test NNTP ready\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        queue = queue.then(() => this.command(line, write, socket));
      }
    });
  }

  async command(line, write, socket) {
    const [verb = '', ...rest] = line.trim().split(/\s+/);
    const argument = rest.join(' ');
    switch (verb.toUpperCase()) {
      case 'CAPABILITIES':
        return write('101 Capability list:\r\nVERSION 2\r\nREADER\r\nAUTHINFO USER\r\n.\r\n');
      case 'MODE':
        return write('200 Posting prohibited\r\n');
      case 'AUTHINFO':
        return write(
          rest[0]?.toUpperCase() === 'USER' ? '381 Password required\r\n' : '281 Accepted\r\n',
        );
      case 'GROUP':
        return write(`211 ${this.articles.size} 1 ${this.articles.size} ${argument || GROUP}\r\n`);
      case 'DATE':
        return write(`111 ${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}\r\n`);
      case 'QUIT':
        write('205 Bye\r\n');
        return socket.end();
      case 'ARTICLE':
      case 'BODY':
      case 'HEAD':
      case 'STAT': {
        const id = argument.replace(/^<|>$/g, '');
        const body = this.articles.get(id);
        if (body === undefined) {
          return write('430 No such article\r\n');
        }
        const kind = verb.toUpperCase();
        const head = `Message-ID: <${id}>\r\nNewsgroups: ${GROUP}\r\nSubject: test\r\nFrom: gladys@gladys.test`;
        if (kind === 'STAT') {
          return write(`223 0 <${id}>\r\n`);
        }
        if (kind === 'HEAD') {
          return write(`221 0 <${id}>\r\n${head}\r\n.\r\n`);
        }
        const text = (kind === 'ARTICLE' ? `${head}\r\n\r\n` : '') + body;
        const stuffed = text.replace(/(^|\r\n)\./g, '$1..');
        const code = kind === 'ARTICLE' ? 220 : 222;
        await this.throttle(Buffer.byteLength(stuffed, 'latin1'));
        return write(`${code} 0 <${id}>\r\n${stuffed}\r\n.\r\n`);
      }
      default:
        return write('500 Unknown command\r\n');
    }
  }

  throttle(size) {
    if (!this.bytesPerSecond) {
      return Promise.resolve();
    }
    return new Promise((resolve) => setTimeout(resolve, (1000 * size) / this.bytesPerSecond));
  }
}

// `node test/real/nntp.js [port] [bytesPerSecond]`: a standalone server, for
// trying the clients by hand.
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new NntpServer({ bytesPerSecond: Number(process.argv[3] ?? 0) });
  const port = await server.listen(Number(process.argv[2] ?? 11119));
  console.log(`NNTP test server on 127.0.0.1:${port}`);
}
