# Module Recherche web

Le module Recherche web cherche sur le web par votre propre instance [SearXNG](https://docs.searxng.org), un métamoteur libre qui interroge plusieurs moteurs à la fois. Il ne demande ni jeton ni compte. Il est surtout utile avec un fournisseur de conversation qui n’a pas de recherche web intégrée, comme un modèle local. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `searxng`).

## Ce que fait le module

- Il répond aux questions qui demandent une information récente ou absente des connaissances du modèle : « quand sort le prochain Dune ? », « qui a gagné le match hier soir ? », « à quelle heure ferme la piscine ? ».
- La carte « Recherche web » rappelle la question, donne la réponse directe de SearXNG quand il y en a une, puis les premiers résultats avec leur site et, si elle est connue, leur date.
- Cornelius reçoit les extraits des résultats et répond à partir d’eux, en citant le site. Si aucun extrait ne répond, il le dit.
- À la voix, on peut préciser la période (« cette semaine », « ce mois-ci ») ou demander les articles de presse (« les dernières nouvelles sur… »).
- Chaque question part à SearXNG : rien n’est gardé en cache, et une réponse n’est jamais resservie pour une autre question.

## Préparer SearXNG

L’instance doit accepter le format JSON. Dans son `settings.yml` :

```yaml
search:
  formats:
    - html
    - json
```

Si le limiteur de SearXNG est activé (`server.limiter: true`), autorisez l’adresse de Cornelius (`pass_ip` dans `limiter.toml`), sinon les recherches peuvent être refusées.

## Réglages d’une source

Dans **Modules → Recherche web → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Adresse de SearXNG | Adresse de l’instance, chemin compris s’il y en a un (`https://searx.maison.lan/searxng`) | `http://127.0.0.1:8080` |
| Langue des résultats | Code de langue envoyé à SearXNG : `fr`, `fr-FR`, `en`… ou `auto` | `fr` |
| Filtre des contenus pour adultes | Aucun, Modéré ou Strict | Modéré |
| Nombre de résultats | Résultats gardés et transmis à Cornelius, de 1 à 5 | 5 |

**Tester** lance une recherche neutre et indique combien de moteurs ont répondu.

## Limites

- La qualité dépend des moteurs activés dans votre instance. Un moteur qui ne répond pas à temps est simplement ignoré par SearXNG.
- Une recherche attend au plus 10 secondes.
- Seuls les extraits des pages sont lus, pas les pages entières : pour une question précise, la réponse peut manquer.
- Messages en cas de problème : « SearXNG refuse le format JSON » (voir plus haut), « SearXNG limite les requêtes », « Aucune instance SearXNG à cette adresse », ou « Réponse de SearXNG illisible » quand une page de connexion se trouve devant l’instance.

## Données

Les résultats viennent des moteurs interrogés par votre instance SearXNG, sous leurs propres conditions. Le module ne garde ni les questions ni les réponses : elles ne sont ni enregistrées dans la base, ni écrites dans le journal de Cornelius.

## Outil vocal et affichage permanent

L’outil s’appelle `searxng__ask`. Il accepte la question (`query`) et deux précisions facultatives : `periode` (`jour`, `semaine`, `mois`, `annee`) et `categorie` (`general`, `actualites`). Ce module ne propose pas d’affichage permanent.

## Auteur

lorloop ([profil GitHub](https://github.com/lorloop)).

## Voir aussi

- [Les modules dans Cornelius](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/README.md)
- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- [Documentation de SearXNG : l’API de recherche](https://docs.searxng.org/dev/search_api.html)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json), nettoyage des textes : [_lib/flux.ts](../_lib/flux.ts)
