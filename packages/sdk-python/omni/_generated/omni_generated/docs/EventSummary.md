# EventSummary


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **UUID** | Event UUID | 
**event_type** | **str** | Event type | 
**content_type** | **str** | Content type | 
**received_at** | **datetime** | When event was received | 
**text_preview** | **str** | First 100 chars of text | 

## Example

```python
from omni_generated.models.event_summary import EventSummary

# TODO update the JSON string below
json = "{}"
# create an instance of EventSummary from a JSON string
event_summary_instance = EventSummary.from_json(json)
# print the JSON string representation of the object
print(EventSummary.to_json())

# convert the object into a dict
event_summary_dict = event_summary_instance.to_dict()
# create an instance of EventSummary from a dict
event_summary_from_dict = EventSummary.from_dict(event_summary_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


