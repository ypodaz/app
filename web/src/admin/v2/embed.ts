import { createContext, useContext } from 'react';

/** true: köhnə (v1) səhifə yeni qabığın içində göstərilir — AdminShell öz yan panelini/alt menyusunu çəkmir,
 *  yalnız başlıq + məzmun + (varsa) detal panelini verir. */
export const EmbedCtx = createContext(false);
export const useEmbedded = () => useContext(EmbedCtx);
