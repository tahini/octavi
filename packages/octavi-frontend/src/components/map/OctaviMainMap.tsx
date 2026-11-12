import React, { PropsWithChildren, useCallback, useEffect, useState } from 'react';

import Preferences from 'chaire-lib-common/lib/config/Preferences';
import serviceLocator from 'chaire-lib-common/lib/utils/ServiceLocator';
import MapLegend from 'octavi-legacy/lib/components/map/MapLegend';
import OctaviMap, { Popup } from 'octavi-legacy/lib/components/map/OctaviMap';
import ZoneMapLayers from 'octavi-legacy/lib/components/map/ZoneMapLayers';

export interface MainMapProps extends PropsWithChildren {
    center?: [number, number] | null;
    zoom?: number | null;
    activeSection?: string;
    heatmap?: {
        property: string;
        title?: string;
        stops: Array<{ value: number; color: string; label?: string }>;
    };
    zoneColor?: string;
}

type ZoneProperties = {
    id?: string | number;
    shortname?: string;
    data?: Record<string, unknown>;
};

type ZoneFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, ZoneProperties>;
type ZoneCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, ZoneProperties>;

const EMPTY_FEATURE_COLLECTION: ZoneCollection = { type: 'FeatureCollection', features: [] };
const DEFAULT_ZONE_COLOR = '#d9d9d9';

const OctaviMainMap = ({ center, zoom, heatmap, zoneColor = DEFAULT_ZONE_COLOR, children }: MainMapProps) => {
    const mapCenter = center || Preferences.get('map.center');
    const mapZoom = zoom || Preferences.get('map.zoom');
    const [zones, setZones] = useState<ZoneCollection>(EMPTY_FEATURE_COLLECTION);
    const [selectedZone, setSelectedZone] = useState<{
        feature: ZoneFeature;
        longitude: number;
        latitude: number;
    } | null>(null);

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

    const handleZoneClick = (event) => {
        const feature = event.features?.[0] as ZoneFeature | undefined;
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

    return (
        <section id="tr__main-map">
            <div id="tr__main-map-context-menu" className="tr__main-map-context-menu"></div>
            <div style={{ position: 'absolute', inset: 0 }}>
                <OctaviMap
                    center={mapCenter}
                    zoom={mapZoom}
                    interactiveLayerIds={['zones-fill']}
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
                    <ZoneMapLayers
                        data={zones}
                        fillColor={zoneColor}
                        heatmapProperty={heatmap?.property}
                        heatmapStops={heatmap?.stops}
                        selections={
                            selectedId !== undefined && selectedId !== null
                                ? [{ id: 'active', ids: [selectedId], color: '#D4230E', opacity: 0.75 }]
                                : []
                        }
                    />
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
                    {children}
                </OctaviMap>
                {heatmap && heatmap.stops.length > 0 && (
                    <MapLegend
                        title={heatmap.title}
                        items={heatmap.stops.map((stop) => ({
                            color: stop.color,
                            label: stop.label ?? String(stop.value)
                        }))}
                    />
                )}
            </div>
        </section>
    );
};

export default OctaviMainMap;
