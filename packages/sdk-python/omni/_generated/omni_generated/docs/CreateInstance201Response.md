# CreateInstance201Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**ListInstances200ResponseItemsInner**](ListInstances200ResponseItemsInner.md) |  | 

## Example

```python
from omni_generated.models.create_instance201_response import CreateInstance201Response

# TODO update the JSON string below
json = "{}"
# create an instance of CreateInstance201Response from a JSON string
create_instance201_response_instance = CreateInstance201Response.from_json(json)
# print the JSON string representation of the object
print(CreateInstance201Response.to_json())

# convert the object into a dict
create_instance201_response_dict = create_instance201_response_instance.to_dict()
# create an instance of CreateInstance201Response from a dict
create_instance201_response_from_dict = CreateInstance201Response.from_dict(create_instance201_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


