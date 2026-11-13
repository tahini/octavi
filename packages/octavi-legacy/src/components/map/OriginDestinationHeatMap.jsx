import React, { useEffect, useState, useRef } from 'react';
import { useMap } from 'react-map-gl/maplibre';

import MapLegend from './MapLegend';
import OctaviMap, { Popup } from './OctaviMap';
import ZoneMapSource from './ZoneMapSource';
import Preferences from 'chaire-lib-common/lib/config/Preferences';
import { ZoneFillLayer, ZoneHeatmapLayer, ZoneOutlineLayer } from './ZoneLayers';

const EMPTY_FEATURE_COLLECTION = { type: 'FeatureCollection', features: [] };
const HEATMAP_LAYER_ID = 'origin-destination-heatmap';
const BASE_LAYER_ID = 'origin-destination-base';

const OriginDestinationHeatMap = ({
    data = EMPTY_FEATURE_COLLECTION,
    property = 'value',
    propertyPath = [],
    stops = [],
    legendTitle,
    baseColor = '#d9d9d9'
}) => {
    const mapRef = useMap().current;
    const [selectedZone, setSelectedZone] = useState(null);
    const hasHeatmap = stops.length >= 2;
    const viewStateRef = useRef({
        longitude: Preferences.get('map.center')[0],
        latitude: Preferences.get('map.center')[1],
        zoom: Preferences.get('map.zoom')
    });

    useEffect(() => {
        const map = mapRef?.getMap();
        if (!map) {
            return undefined;
        }

        const handleZoneClick = (event) => {
            const feature = event.features?.[0];
            if (!feature) {
                return;
            }

            const id = feature.properties?.id ?? feature.id;
            setSelectedZone((current) => {
                const currentId = current?.feature.properties?.id ?? current?.feature.id;
                return id !== undefined && String(id) === String(currentId)
                    ? null
                    : { feature, longitude: event.lngLat.lng, latitude: event.lngLat.lat };
            });
        };
        const handleMouseEnter = () => {
            map.getCanvas().style.cursor = 'pointer';
        };
        const handleMouseLeave = () => {
            map.getCanvas().style.cursor = '';
        };
        const addLayerClickListener = () => {
            const layerId = hasHeatmap ? HEATMAP_LAYER_ID : BASE_LAYER_ID;
            if (map.getLayer(layerId)) {
                map.on('click', layerId, handleZoneClick);
                map.on('mouseenter', layerId, handleMouseEnter);
                map.on('mouseleave', layerId, handleMouseLeave);
                map.off('styledata', addLayerClickListener);
            }
        };
        map.on('styledata', addLayerClickListener);
        addLayerClickListener();

        return () => {
            map.off('click', HEATMAP_LAYER_ID, handleZoneClick);
            map.off('click', BASE_LAYER_ID, handleZoneClick);
            map.off('mouseenter', HEATMAP_LAYER_ID, handleMouseEnter);
            map.off('mouseenter', BASE_LAYER_ID, handleMouseEnter);
            map.off('mouseleave', HEATMAP_LAYER_ID, handleMouseLeave);
            map.off('mouseleave', BASE_LAYER_ID, handleMouseLeave);
            map.off('styledata', addLayerClickListener);
            map.getCanvas().style.cursor = '';
        };
    }, [mapRef, hasHeatmap]);

    const feature = selectedZone?.feature;
    const selectedId = feature?.properties?.id ?? feature?.id;
    const popupProperties = Object.entries(feature?.properties || {}).filter(
        ([key, value]) => key !== 'id' && key !== 'data' && value !== undefined && value !== null
    );

    return (
        <OctaviMap
            initialViewState={viewStateRef.current}
            style={{ width: '100%', height: '100%' }}
            interactiveLayerIds={[BASE_LAYER_ID]}
            onMove={(event) => {
                viewStateRef.current = event.viewState;
            }}
            dragRotate={false}
        >
            <ZoneMapSource id="origin-destination-zones" data={data}>
                <ZoneFillLayer
                    id={BASE_LAYER_ID}
                    sourceId="origin-destination-zones"
                    fillColor={baseColor}
                    fillOpacity={hasHeatmap ? 0.15 : 0.35}
                />
                {hasHeatmap && (
                    <ZoneHeatmapLayer
                        id={HEATMAP_LAYER_ID}
                        sourceId="origin-destination-zones"
                        property={property}
                        propertyPath={propertyPath}
                        stops={stops}
                        fillOpacity={0.75}
                    />
                )}
                <ZoneOutlineLayer id="origin-destination-outline" sourceId="origin-destination-zones" />
            </ZoneMapSource>
            {hasHeatmap && <MapLegend title={legendTitle} items={stops} />}
            {selectedZone && (
                <Popup
                    longitude={selectedZone.longitude}
                    latitude={selectedZone.latitude}
                    closeButton={true}
                    closeOnClick={false}
                    onClose={() => setSelectedZone(null)}
                    anchor="bottom"
                >
                    <div className="octavi-map-popup">
                        <strong>
                            {feature?.properties?.SM_name ||
                                feature?.properties?.shortname ||
                                String(selectedId)}
                        </strong>
                        {popupProperties.map(([key, value]) => (
                            <div key={key}>
                                <strong>{key}: </strong>
                                {typeof value === 'string' || typeof value === 'number'
                                    ? String(value)
                                    : JSON.stringify(value)}
                            </div>
                        ))}
                    </div>
                </Popup>
            )}
        </OctaviMap>
    );
};

export default OriginDestinationHeatMap;
