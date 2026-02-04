# CreateAccessRule201Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**ListAccessRules200ResponseItemsInner**](ListAccessRules200ResponseItemsInner.md) |  | 

## Example

```python
from omni_generated.models.create_access_rule201_response import CreateAccessRule201Response

# TODO update the JSON string below
json = "{}"
# create an instance of CreateAccessRule201Response from a JSON string
create_access_rule201_response_instance = CreateAccessRule201Response.from_json(json)
# print the JSON string representation of the object
print(CreateAccessRule201Response.to_json())

# convert the object into a dict
create_access_rule201_response_dict = create_access_rule201_response_instance.to_dict()
# create an instance of CreateAccessRule201Response from a dict
create_access_rule201_response_from_dict = CreateAccessRule201Response.from_dict(create_access_rule201_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


