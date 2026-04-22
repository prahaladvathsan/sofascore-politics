# Map Data

This repository now keeps two map layers under `data/geo/`:

- `source/`: committed Datameet source snapshots at commit `b3fbbde595310b397a55d718e0958ce249a4fa1f`
- `optimized/`: build-time simplified and quantized TopoJSON served by the client

Current optimized outputs:

- `optimized/india-states.topojson`
- `optimized/tn-assembly.topojson`
- `optimized/wb-assembly.topojson`

Build guarantees:

- national TopoJSON stays under `150KB`
- each per-state constituency TopoJSON stays under `400KB`
- `public/data/` publishes only the optimized geometry, not the raw source snapshot

Source notes:

- National state and UT boundaries come from Datameet `States/Admin2.*`
- MVP constituency boundaries come from Datameet `website/docs/data/geojson/ac.geojson`, filtered to Tamil Nadu and West Bengal
- Datameet notes these layers are released under `CC BY 2.5 India` and include known caveats around historical delimitations in some regions
