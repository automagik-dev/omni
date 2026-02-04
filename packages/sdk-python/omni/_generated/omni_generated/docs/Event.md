# Event


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **UUID** | Event UUID | 
**event_type** | **str** | Event type | 
**content_type** | **str** | Content type | 
**instance_id** | **UUID** | Instance UUID | 
**person_id** | **UUID** | Person UUID | 
**direction** | **str** | Message direction | 
**text_content** | **str** | Text content | 
**transcription** | **str** | Audio transcription | 
**image_description** | **str** | Image description | 
**received_at** | **datetime** | When event was received | 
**processed_at** | **datetime** | When event was processed | 

## Example

```python
from omni_generated.models.event import Event

# TODO update the JSON string below
json = "{}"
# create an instance of Event from a JSON string
event_instance = Event.from_json(json)
# print the JSON string representation of the object
print(Event.to_json())

# convert the object into a dict
event_dict = event_instance.to_dict()
# create an instance of Event from a dict
event_from_dict = Event.from_dict(event_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


