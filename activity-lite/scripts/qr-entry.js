import QRCode from 'qrcode';
export function draw(canvas, value) {
  return QRCode.toCanvas(canvas, value, {
    width: 288,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {dark:'#1b3057',light:'#ffffff'}
  });
}
