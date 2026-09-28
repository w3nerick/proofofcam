// Íconos de Phosphor, inlineados como SVG: la app no carga nada de fuera.
import camera from '@phosphor-icons/core/regular/camera.svg?raw';
import aperture from '@phosphor-icons/core/regular/aperture.svg?raw';
import cameraRotate from '@phosphor-icons/core/regular/camera-rotate.svg?raw';
import mapPin from '@phosphor-icons/core/regular/map-pin.svg?raw';
import user from '@phosphor-icons/core/regular/user.svg?raw';
import detective from '@phosphor-icons/core/regular/detective.svg?raw';
import sealCheck from '@phosphor-icons/core/regular/seal-check.svg?raw';
import shareNetwork from '@phosphor-icons/core/regular/share-network.svg?raw';
import downloadSimple from '@phosphor-icons/core/regular/download-simple.svg?raw';
import copy from '@phosphor-icons/core/regular/copy.svg?raw';
import qrCode from '@phosphor-icons/core/regular/qr-code.svg?raw';
import lockSimple from '@phosphor-icons/core/regular/lock-simple.svg?raw';
import shieldCheck from '@phosphor-icons/core/regular/shield-check.svg?raw';
import arrowLeft from '@phosphor-icons/core/regular/arrow-left.svg?raw';
import arrowRight from '@phosphor-icons/core/regular/arrow-right.svg?raw';
import image from '@phosphor-icons/core/regular/image.svg?raw';
import magnifyingGlass from '@phosphor-icons/core/regular/magnifying-glass.svg?raw';
import warningCircle from '@phosphor-icons/core/regular/warning-circle.svg?raw';
import checkCircle from '@phosphor-icons/core/regular/check-circle.svg?raw';
import xCircle from '@phosphor-icons/core/regular/x-circle.svg?raw';
import cube from '@phosphor-icons/core/regular/cube.svg?raw';
import clock from '@phosphor-icons/core/regular/clock.svg?raw';
import fingerprint from '@phosphor-icons/core/regular/fingerprint.svg?raw';
import eyeSlash from '@phosphor-icons/core/regular/eye-slash.svg?raw';
import eye from '@phosphor-icons/core/regular/eye.svg?raw';
import arrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?raw';
import info from '@phosphor-icons/core/regular/info.svg?raw';
import stamp from '@phosphor-icons/core/regular/stamp.svg?raw';
import signature from '@phosphor-icons/core/regular/signature.svg?raw';
import wallet from '@phosphor-icons/core/regular/wallet.svg?raw';
import lightning from '@phosphor-icons/core/regular/lightning.svg?raw';
import sealFill from '@phosphor-icons/core/fill/seal-check-fill.svg?raw';

const set = {
  camera, aperture, cameraRotate, mapPin, user, detective, sealCheck, shareNetwork, downloadSimple, copy, qrCode,
  lockSimple, shieldCheck, arrowLeft, arrowRight, image, magnifyingGlass, warningCircle, checkCircle, xCircle, cube,
  clock, fingerprint, eyeSlash, eye, arrowCounterClockwise, info, stamp, signature, wallet, lightning, sealFill,
};

export type IconName = keyof typeof set;

export function icon(name: IconName, cls = ''): string {
  return set[name].replace('<svg ', `<svg class="ico ${cls}" aria-hidden="true" `);
}
