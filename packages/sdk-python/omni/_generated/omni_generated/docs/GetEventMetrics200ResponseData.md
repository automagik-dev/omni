# GetEventMetrics200ResponseData


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
from omni_generated.models.get_event_metrics200_response_data import GetEventMetrics200ResponseData

# TODO update the JSON string below
json = "{}"
# create an instance of GetEventMetrics200ResponseData from a JSON string
get_event_metrics200_response_data_instance = GetEventMetrics200ResponseData.from_json(json)
# print the JSON string representation of the object
print(GetEventMetrics200ResponseData.to_json())

# convert the object into a dict
get_event_metrics200_response_data_dict = get_event_metrics200_response_data_instance.to_dict()
# create an instance of GetEventMetrics200ResponseData from a dict
get_event_metrics200_response_data_from_dict = GetEventMetrics200ResponseData.from_dict(get_event_metrics200_response_data_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


