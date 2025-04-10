/*
 * Copyright (C) 2023-2025  Yomitan Authors
 * Copyright (C) 2021-2022  Yomichan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Decodes the contents of an ArrayBuffer using UTF8.
 * @param {ArrayBuffer} arrayBuffer The input ArrayBuffer.
 * @returns {string} A UTF8-decoded string.
 */
export function arrayBufferUtf8Decode(arrayBuffer) {
    try {
        return new TextDecoder('utf-8').decode(arrayBuffer);
    } catch (e) {
        return decodeURIComponent(escape(arrayBufferToBinaryString(arrayBuffer)));
    }
}

// /**
//  * Converts the contents of an ArrayBuffer to a base64 string.
//  * @param {ArrayBuffer} arrayBuffer The input ArrayBuffer.
//  * @returns {string} A base64 string representing the binary content.
//  */
// export function arrayBufferToBase64(arrayBuffer) {
//     return btoa(arrayBufferToBinaryString(arrayBuffer));
// }

/**
 * Converts the contents of an ArrayBuffer to a binary string.
 * @param {ArrayBuffer} arrayBuffer The input ArrayBuffer.
 * @returns {string} A string representing the binary content.
 */
export function arrayBufferToBinaryString(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    try {
        return String.fromCharCode(...bytes);
    } catch (e) {
        let binary = '';
        for (let i = 0, ii = bytes.byteLength; i < ii; ++i) {
            binary += String.fromCharCode(bytes[i]);
        }
        return binary;
    }
}

/**
 * Converts a base64 string to an ArrayBuffer.
 * @param {string} content The binary content string encoded in base64.
 * @returns {ArrayBuffer} A new `ArrayBuffer` object corresponding to the specified content.
 */
export function base64ToArrayBuffer(content) {
    const binaryContent = atob(content);
    const length = binaryContent.length;
    const array = new Uint8Array(length);
    for (let i = 0; i < length; ++i) {
        array[i] = binaryContent.charCodeAt(i);
    }
    return array.buffer;
}

/*
 * https://gist.github.com/jonleighton/958841
 * MIT LICENSE
 * Copyright 2011 Jon Leighton
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/**
 * Converts the contents of an ArrayBuffer to a base64 string.
 * 25% faster than btoa according to https://jsben.ch/wnaZC
 * @param {ArrayBuffer} arrayBuffer The input ArrayBuffer.
 * @returns {string} A base64 string representing the binary content.
 */
export function arrayBufferToBase64(arrayBuffer) {
  var base64    = ''
  var encodings = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

  var bytes         = new Uint8Array(arrayBuffer)
  var byteLength    = bytes.byteLength
  var byteRemainder = byteLength % 3
  var mainLength    = byteLength - byteRemainder

  var a, b, c, d
  var chunk

  // Main loop deals with bytes in chunks of 3
  for (var i = 0; i < mainLength; i = i + 3) {
    // Combine the three bytes into a single integer
    chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]

    // Use bitmasks to extract 6-bit segments from the triplet
    a = (chunk & 16515072) >> 18 // 16515072 = (2^6 - 1) << 18
    b = (chunk & 258048)   >> 12 // 258048   = (2^6 - 1) << 12
    c = (chunk & 4032)     >>  6 // 4032     = (2^6 - 1) << 6
    d = chunk & 63               // 63       = 2^6 - 1

    // Convert the raw binary segments to the appropriate ASCII encoding
    base64 += encodings[a] + encodings[b] + encodings[c] + encodings[d]
  }

  // Deal with the remaining bytes and padding
  if (byteRemainder == 1) {
    chunk = bytes[mainLength]

    a = (chunk & 252) >> 2 // 252 = (2^6 - 1) << 2

    // Set the 4 least significant bits to zero
    b = (chunk & 3)   << 4 // 3   = 2^2 - 1

    base64 += encodings[a] + encodings[b] + '=='
  } else if (byteRemainder == 2) {
    chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1]

    a = (chunk & 64512) >> 10 // 64512 = (2^6 - 1) << 10
    b = (chunk & 1008)  >>  4 // 1008  = (2^6 - 1) << 4

    // Set the 2 least significant bits to zero
    c = (chunk & 15)    <<  2 // 15    = 2^4 - 1

    base64 += encodings[a] + encodings[b] + encodings[c] + '='
  }
  
  return base64
}
