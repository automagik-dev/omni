# EventMetrics


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**total** | **int** | Total events | 
**today** | **int** | Events today | 
**by_type** | **Dict[str, float]** | Count by type | 
**by_channel** | **Dict[str, float]** | Count by channel | 
**avg_processing_time** | **float** | Avg processing time (ms) | 

## Example

```python
from omni_generated.models.event_metrics import EventMetrics

# TODO update the JSON string below
json = "{}"
# create an instance of EventMetrics from a JSON string
event_metrics_instance = EventMetrics.from_json(json)
# print the JSON string representation of the object
print(EventMetrics.to_json())

# convert the object into a dict
event_metrics_dict = event_metrics_instance.to_dict()
# create an instance of EventMetrics from a dict
event_metrics_from_dict = EventMetrics.from_dict(event_metrics_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


