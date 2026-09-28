// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title PhotoRegistry: actas de nacimiento de fotos tomadas con Testigo
/// @notice Por cada foto guarda su huella, la llave que la firmó, la firma y el
///         recibo completo. La foto no se guarda en ningún lado: se queda en el
///         teléfono de quien la tomó.
/// @dev Qué aporta cada campo a la verificación:
///      - `imageHash` (sha256 de los bytes exactos del archivo) prueba que una
///        copia es idéntica a la sellada. `idOf` encuentra el acta sin el QR.
///      - `visualHash` (dHash de 64 bits) reconoce la misma foto después de que
///        un chat la recomprima o le cambie el tamaño.
///      - `blockNumber` y `sealedAt` son la cota SUPERIOR de tiempo: la foto
///        existía a más tardar en este bloque. `anchorBlock`, el bloque que el
///        teléfono vio justo antes del disparo, da la cota inferior.
///      - `receipt` son los bytes exactos que cubre la firma sr25519 de
///        `pubkey`; la firma se verifica fuera del contrato.
///
///      El contrato NO verifica la firma ni exige que el llamante sea el dueño
///      de `pubkey`: un acta con firma falsa no valida en ningún verificador. Lo
///      primero que se sella gana; nada se sobrescribe.
contract PhotoRegistry {
    struct Photo {
        bytes32 imageHash;
        bytes32 pubkey;
        uint64 visualHash;
        uint32 anchorBlock;
        uint64 blockNumber;
        uint64 sealedAt;
        address submitter;
        bytes sig;
        bytes receipt;
    }

    /// Un recibo con ubicación cifrada ronda los 700 bytes.
    uint256 public constant MAX_RECEIPT = 1024;

    mapping(bytes16 => Photo) private photos;
    mapping(bytes32 => bytes16) private byImage;
    bytes16[] private ids;

    event Sealed(bytes16 indexed id, bytes32 indexed imageHash, bytes32 indexed pubkey);

    error EmptyId();
    error EmptyHash();
    error AlreadySealed(bytes16 id);
    error ImageAlreadySealed(bytes32 imageHash);
    error BadSignatureLength(uint256 length);
    error BadReceiptLength(uint256 length);

    /// @param id          identificador de la foto, el mismo que va en su QR
    /// @param imageHash   sha256 de los bytes exactos de la foto
    /// @param visualHash  dHash de 64 bits de la foto
    /// @param pubkey      llave sr25519 que firmó el recibo
    /// @param anchorBlock bloque previo al disparo (cota inferior de tiempo)
    /// @param sig         firma sr25519 de 64 bytes sobre `receipt`
    /// @param receipt     recibo canónico (JSON UTF-8)
    function seal(
        bytes16 id,
        bytes32 imageHash,
        uint64 visualHash,
        bytes32 pubkey,
        uint32 anchorBlock,
        bytes calldata sig,
        bytes calldata receipt
    ) external {
        if (id == bytes16(0)) revert EmptyId();
        if (imageHash == bytes32(0)) revert EmptyHash();
        if (photos[id].submitter != address(0)) revert AlreadySealed(id);
        if (byImage[imageHash] != bytes16(0)) revert ImageAlreadySealed(imageHash);
        if (sig.length != 64) revert BadSignatureLength(sig.length);
        if (receipt.length == 0 || receipt.length > MAX_RECEIPT) revert BadReceiptLength(receipt.length);

        photos[id] = Photo({
            imageHash: imageHash,
            pubkey: pubkey,
            visualHash: visualHash,
            anchorBlock: anchorBlock,
            blockNumber: uint64(block.number),
            sealedAt: uint64(block.timestamp),
            submitter: msg.sender,
            sig: sig,
            receipt: receipt
        });
        byImage[imageHash] = id;
        ids.push(id);
        emit Sealed(id, imageHash, pubkey);
    }

    /// @notice Acta de una foto. `submitter == address(0)` significa que no existe.
    function get(bytes16 id) external view returns (Photo memory) {
        return photos[id];
    }

    /// @notice Acta de una copia exacta, sin necesidad del QR. Cero si no existe.
    function idOf(bytes32 imageHash) external view returns (bytes16) {
        return byImage[imageHash];
    }

    function total() external view returns (uint256) {
        return ids.length;
    }

    /// @notice Ids y huellas visuales en orden de sellado: con esto el
    ///         verificador reconoce una copia recomprimida que perdió el QR.
    function page(uint256 start, uint256 count) external view returns (bytes16[] memory outIds, uint64[] memory visual) {
        uint256 n = ids.length;
        if (start >= n) return (new bytes16[](0), new uint64[](0));
        uint256 end = start + count > n ? n : start + count;
        outIds = new bytes16[](end - start);
        visual = new uint64[](end - start);
        for (uint256 i = start; i < end; i++) {
            outIds[i - start] = ids[i];
            visual[i - start] = photos[ids[i]].visualHash;
        }
    }
}
