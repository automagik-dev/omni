# GetDeadLetter200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**ListDeadLetters200ResponseItemsInner**](ListDeadLetters200ResponseItemsInner.md) |  | 

## Example

```python
from omni_generated.models.get_dead_letter200_response import GetDeadLetter200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetDeadLetter200Response from a JSON string
get_dead_letter200_response_instance = GetDeadLetter200Response.from_json(json)
# print the JSON string representation of the object
print(GetDeadLetter200Response.to_json())

# convert the object into a dict
get_dead_letter200_response_dict = get_dead_letter200_response_instance.to_dict()
# create an instance of GetDeadLetter200Response from a dict
get_dead_letter200_response_from_dict = GetDeadLetter200Response.from_dict(get_dead_letter200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


