# ListReplaySessions200ResponseItemsInnerOptions


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**since** | **datetime** | Start date (required) | 
**until** | **datetime** | End date | [optional] 
**event_types** | **List[str]** | Event types to replay | [optional] 
**instance_id** | **UUID** | Filter by instance | [optional] 
**limit** | **int** | Max events | [optional] 
**speed_multiplier** | **float** | Replay speed | [optional] 
**skip_processed** | **bool** | Skip already processed | [optional] 
**dry_run** | **bool** | Dry run mode | [optional] 

## Example

```python
from omni_generated.models.list_replay_sessions200_response_items_inner_options import ListReplaySessions200ResponseItemsInnerOptions

# TODO update the JSON string below
json = "{}"
# create an instance of ListReplaySessions200ResponseItemsInnerOptions from a JSON string
list_replay_sessions200_response_items_inner_options_instance = ListReplaySessions200ResponseItemsInnerOptions.from_json(json)
# print the JSON string representation of the object
print(ListReplaySessions200ResponseItemsInnerOptions.to_json())

# convert the object into a dict
list_replay_sessions200_response_items_inner_options_dict = list_replay_sessions200_response_items_inner_options_instance.to_dict()
# create an instance of ListReplaySessions200ResponseItemsInnerOptions from a dict
list_replay_sessions200_response_items_inner_options_from_dict = ListReplaySessions200ResponseItemsInnerOptions.from_dict(list_replay_sessions200_response_items_inner_options_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


