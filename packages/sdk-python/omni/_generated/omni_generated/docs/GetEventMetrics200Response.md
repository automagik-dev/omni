# GetEventMetrics200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**GetEventMetrics200ResponseData**](GetEventMetrics200ResponseData.md) |  | 

## Example

```python
from omni_generated.models.get_event_metrics200_response import GetEventMetrics200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetEventMetrics200Response from a JSON string
get_event_metrics200_response_instance = GetEventMetrics200Response.from_json(json)
# print the JSON string representation of the object
print(GetEventMetrics200Response.to_json())

# convert the object into a dict
get_event_metrics200_response_dict = get_event_metrics200_response_instance.to_dict()
# create an instance of GetEventMetrics200Response from a dict
get_event_metrics200_response_from_dict = GetEventMetrics200Response.from_dict(get_event_metrics200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


