/**
 * Red de destino: Asset Hub del Products Devnet, la misma de testalk.
 * Genesis medido por RPC el 23 sep 2026.
 */
export const NETWORK = 'products-devnet';
export const ASSET_HUB_GENESIS = '0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2' as const;
export const PUBLIC_WS = [
  'wss://asset-hub-paseo-rpc.n.dwellir.com',
  'wss://sys.turboflakes.io/asset-hub-paseo',
];

/** People chain del devnet: de quién es cada username. */
export const PEOPLE_GENESIS = '0xe6c30d6e148f250b887105237bcaa5cb9f16dd203bf7b5b9d4f1da7387cb86ec' as const;
export const PEOPLE_WS = [
  'wss://people-paseo.gatotech.network',
  'wss://rpc.interweb-it.com/people-paseo',
  'wss://people-paseo.rotko.net',
];

/**
 * Dominio de la app. Regla de DotNS v2: los dígitos finales deben ser 0 o 2 y
 * el resto es la base; con base de 9 o más el registro es abierto (`testigo`,
 * de 7, pediría personhood). Si cambia, cambiarlo también en package.json
 * (deploy) y en polkadot-app-deploy.config.ts. Define además la cuenta de
 * producto de la app, que es la del modo seudónimo.
 */
export const APP_LABEL = 'testigocam26';
export const APP_DOTNS = `${APP_LABEL}.dot`;

/**
 * La misma app en el gateway web. El QR de cada foto apunta aquí: abre en
 * cualquier navegador, sin Polkadot App.
 */
export const WEB_GATEWAY = `https://${APP_LABEL}.dev-dot.li`;

/**
 * PhotoRegistry en pallet-revive. Desplegado el 28 sep 2026, bloque 13,812,904
 * (ver contract/deployments.json). Vacío = sin desplegar: la app lo dice en
 * pantalla en vez de fallar.
 */
export const REGISTRY_ADDRESS = '0xa0d30345400061439517417fc0a202adfe3ebb27' as `0x${string}` | '';

export const FAUCET_URL = 'https://faucet.polkadot.io';

/** Gateway IPFS del devnet: lo usa scripts/check-deploy.ts para comparar el deploy con dist/. */
export const IPFS_GATEWAY = 'https://devnet-ipfs.api.polkadotcommunity.foundation/ipfs';
