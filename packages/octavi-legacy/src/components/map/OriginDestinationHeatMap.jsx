import React, { PropsWithChildren, useCallback, useEffect, useState } from 'react';

import Preferences from 'chaire-lib-common/lib/config/Preferences';
import serviceLocator from 'chaire-lib-common/lib/utils/ServiceLocator';
import MapLegend from 'octavi-legacy/lib/components/map/MapLegend';
import OctaviMap, { Popup } from 'octavi-legacy/lib/components/map/OctaviMap';
import ZoneMapSource from 'octavi-legacy/lib/components/map/ZoneMapSource';
import {
    ZoneFillLayer,
    ZoneHeatmapLayer,
    ZoneOutlineLayer,
    ZoneSelectionLayer
} from 'octavi-legacy/lib/components/map/ZoneLayers';

const EMPTY_FEATURE_COLLECTION = { type: 'FeatureCollection', features: [] };
const DEFAULT_ZONE_COLOR = '#d9d9d9';

const OriginDestinationHeatMap = ({ heatmap, zoneColor = DEFAULT_ZONE_COLOR }) => {
    const mapCenter = Preferences.get('map.center');
    const mapZoom = Preferences.get('map.zoom');
    const [zones, setZones] = useState(EMPTY_FEATURE_COLLECTION);
    const [selectedZone, setSelectedZone] = useState(null);

    const loadZones = useCallback(() => {
        if (serviceLocator.collectionManager.has('zones')) {
            setZones(serviceLocator.collectionManager.get('zones').toGeojsonSimplified());
        }
    }, []);

    useEffect(() => {
        serviceLocator.eventManager.on('taxi.filter.spatial.enable', loadZones);
        loadZones();
        return () => serviceLocator.eventManager.off('taxi.filter.spatial.enable', loadZones);
    }, [loadZones]);

    const handleMapLoad = () => {
        serviceLocator.eventManager.emit('map.loaded');
    };

    console.log('displaying %d zones', zones.features.length)

    const handleZoneClick = (event) => {
        const feature = event.features?.[0];
        if (!feature) {
            setSelectedZone(null);
            return;
        }

        const id = feature.properties?.id ?? feature.id;
        const selectedId = selectedZone?.feature.properties?.id ?? selectedZone?.feature.id;
        if (id !== undefined && String(id) === String(selectedId)) {
            setSelectedZone(null);
            return;
        }

        setSelectedZone({
            feature,
            longitude: event.lngLat.lng,
            latitude: event.lngLat.lat
        });
    };

    const selectedId = selectedZone?.feature.properties?.id ?? selectedZone?.feature.id;
    const featureData = selectedZone?.feature.properties?.data;
    const hasHeatmap = Boolean(heatmap && heatmap.stops.length >= 2);

    return (
        <OctaviMap
            center={mapCenter}
            zoom={mapZoom}
            interactiveLayerIds={
                hasHeatmap ? ['zone-heatmap-fill', 'zone-base-fill'] : ['zone-base-fill']
            }
            onLoad={handleMapLoad}
            onClick={handleZoneClick}
            onMouseMove={(event) => {
                if (event.features?.length) {
                    event.target.getCanvas().style.cursor = 'pointer';
                } else {
                    event.target.getCanvas().style.cursor = '';
                }
            }}
        >
            <ZoneMapSource id="octavi-zones" data={zones}>
                <ZoneFillLayer id="zone-base-fill" sourceId="octavi-zones" fillColor={zoneColor} />
                {hasHeatmap && heatmap && (
                    <ZoneHeatmapLayer
                        id="zone-heatmap-fill"
                        sourceId="octavi-zones"
                        property={heatmap.property}
                        propertyPath={heatmap.propertyPath || []}
                        stops={heatmap.stops}
                    />
                )}
                {selectedId !== undefined && selectedId !== null && (
                    <ZoneSelectionLayer
                        id="zone-selection"
                        sourceId="octavi-zones"
                        selectedIds={[selectedId]}
                        fillColor="#D4230E"
                        fillOpacity={0.75}
                    />
                )}
                <ZoneOutlineLayer id="zone-outline" sourceId="octavi-zones" />
            </ZoneMapSource>
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
                        <strong>{selectedZone.feature.properties?.shortname || String(selectedId)}</strong>
                        {featureData &&
                            Object.entries(featureData).map(([key, value]) => (
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
