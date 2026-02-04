# GetEventAnalytics200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**total_events** | **int** | Total event count | 
**by_event_type** | **Dict[str, float]** | Count by event type | 
**by_channel** | **Dict[str, float]** | Count by channel | 
**by_direction** | [**GetEventAnalytics200ResponseByDirection**](GetEventAnalytics200ResponseByDirection.md) |  | 

## Example

```python
from omni_generated.models.get_event_analytics200_response import GetEventAnalytics200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetEventAnalytics200Response from a JSON string
get_event_analytics200_response_instance = GetEventAnalytics200Response.from_json(json)
# print the JSON string representation of the object
print(GetEventAnalytics200Response.to_json())

# convert the object into a dict
get_event_analytics200_response_dict = get_event_analytics200_response_instance.to_dict()
# create an instance of GetEventAnalytics200Response from a dict
get_event_analytics200_response_from_dict = GetEventAnalytics200Response.from_dict(get_event_analytics200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


