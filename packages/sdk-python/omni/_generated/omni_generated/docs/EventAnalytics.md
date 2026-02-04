# EventAnalytics


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**total_events** | **int** | Total event count | 
**by_event_type** | **Dict[str, float]** | Count by event type | 
**by_channel** | **Dict[str, float]** | Count by channel | 
**by_direction** | [**GetEventAnalytics200ResponseByDirection**](GetEventAnalytics200ResponseByDirection.md) |  | 

## Example

```python
from omni_generated.models.event_analytics import EventAnalytics

# TODO update the JSON string below
json = "{}"
# create an instance of EventAnalytics from a JSON string
event_analytics_instance = EventAnalytics.from_json(json)
# print the JSON string representation of the object
print(EventAnalytics.to_json())

# convert the object into a dict
event_analytics_dict = event_analytics_instance.to_dict()
# create an instance of EventAnalytics from a dict
event_analytics_from_dict = EventAnalytics.from_dict(event_analytics_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


