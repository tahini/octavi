import React, { useMemo } from 'react';
import { Layer, Source } from 'react-map-gl/maplibre';

const EMPTY_FEATURE_COLLECTION = {
    type: 'FeatureCollection',
    features: []
};

const getFeatureId = (feature) => feature.properties?.id ?? feature.id;

const ZoneMapLayers = ({
    data = EMPTY_FEATURE_COLLECTION,
    fillColor = '#d9d9d9',
    fillOpacity = 0.35,
    lineColor = '#333333',
    selections = [],
    heatmapProperty,
    heatmapStops = []
}) => {
    const dataWithPropertyIds = useMemo(
        () => ({
            ...data,
            features: data.features.map((feature) => {
                const id = getFeatureId(feature);
                return {
                    ...feature,
                    properties: {
                        ...feature.properties,
                        ...(id !== undefined && id !== null ? { id } : {})
                    }
                };
            })
        }),
        [data]
    );

    const normalizedFeatures = useMemo(
        () =>
            dataWithPropertyIds.features.map((feature) => ({
                feature,
                id: getFeatureId(feature)
            })),
        [dataWithPropertyIds]
    );
    const orderedHeatmapStops = useMemo(
        () => [...heatmapStops].sort((a, b) => a.value - b.value),
        [heatmapStops]
    );

    return (
        <>
            <Source id="octavi-zones" type="geojson" data={dataWithPropertyIds} promoteId="id">
                <Layer
                    id="zones-fill"
                    type="fill"
                    paint={{
                        'fill-color':
                            heatmapProperty && orderedHeatmapStops.length >= 2
                                ? [
                                      'interpolate',
                                      ['linear'],
                                      ['to-number', ['get', heatmapProperty, ['get', 'data']], 0],
                                          ...orderedHeatmapStops.flatMap((stop) => [stop.value, stop.color])
                                  ]
                                : fillColor,
                        'fill-opacity': fillOpacity
                    }}
                />
            </Source>
            {selections.map((selection) => {
                const selectedIds = new Set((selection.ids || []).map(String));
                const selectedData = {
                    ...dataWithPropertyIds,
                    features: normalizedFeatures
                        .filter(({ id }) => id !== undefined && id !== null && selectedIds.has(String(id)))
                        .map(({ feature }) => feature)
                };
                return (
                    <Source
                        key={selection.id}
                        id={`octavi-zone-selection-${selection.id}`}
                        type="geojson"
                        data={selectedData}
                        promoteId="id"
                    >
                        <Layer
                            id={`zone-selection-${selection.id}`}
                            type="fill"
                            paint={{
                                'fill-color': selection.color || '#468024',
                                'fill-opacity': selection.opacity ?? 0.7
                            }}
                        />
                    </Source>
                );
            })}
            <Source id="octavi-zone-outlines" type="geojson" data={dataWithPropertyIds} promoteId="id">
                <Layer
                    id="zones-outline"
                    type="line"
                    paint={{ 'line-color': lineColor, 'line-opacity': 0.8, 'line-width': 1 }}
                />
            </Source>
        </>
    );
};

export default ZoneMapLayers;
