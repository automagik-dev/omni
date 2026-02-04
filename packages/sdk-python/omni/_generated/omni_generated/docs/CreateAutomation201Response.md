# CreateAutomation201Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**ListAutomations200ResponseItemsInner**](ListAutomations200ResponseItemsInner.md) |  | 

## Example

```python
from omni_generated.models.create_automation201_response import CreateAutomation201Response

# TODO update the JSON string below
json = "{}"
# create an instance of CreateAutomation201Response from a JSON string
create_automation201_response_instance = CreateAutomation201Response.from_json(json)
# print the JSON string representation of the object
print(CreateAutomation201Response.to_json())

# convert the object into a dict
create_automation201_response_dict = create_automation201_response_instance.to_dict()
# create an instance of CreateAutomation201Response from a dict
create_automation201_response_from_dict = CreateAutomation201Response.from_dict(create_automation201_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


