// Point d'entrée du Worker. N'exporter ici que le gestionnaire : Cloudflare traite chaque
// export du module principal comme un point d'entrée. La logique est dans service.js.
import { traiter } from './service.js';

export default {
  fetch(request, env) { return traiter(request, env); },
};
