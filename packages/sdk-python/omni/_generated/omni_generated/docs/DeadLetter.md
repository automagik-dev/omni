# DeadLetter


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **UUID** | Dead letter UUID | 
**event_id** | **UUID** | Original event UUID | 
**event_type** | **str** | Event type | 
**status** | **str** | Status | 
**error_message** | **str** | Error message | 
**error_stack** | **str** | Error stack trace | 
**retry_count** | **int** | Retry attempts | 
**last_retry_at** | **datetime** | Last retry timestamp | 
**resolved_at** | **datetime** | Resolution timestamp | 
**resolution_note** | **str** | Resolution note | 
**created_at** | **datetime** | Creation timestamp | 

## Example

```python
from omni_generated.models.dead_letter import DeadLetter

# TODO update the JSON string below
json = "{}"
# create an instance of DeadLetter from a JSON string
dead_letter_instance = DeadLetter.from_json(json)
# print the JSON string representation of the object
print(DeadLetter.to_json())

# convert the object into a dict
dead_letter_dict = dead_letter_instance.to_dict()
# create an instance of DeadLetter from a dict
dead_letter_from_dict = DeadLetter.from_dict(dead_letter_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


